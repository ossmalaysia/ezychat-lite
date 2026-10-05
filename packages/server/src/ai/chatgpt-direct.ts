/**
 * EXPERIMENTAL (owner-approved spike): ChatGPT-mode provider that signs in with the Codex OAuth
 * client and calls the ChatGPT Codex backend directly — no Codex binary. Non-public endpoints;
 * may break without notice. API-key mode still uses the public OpenAI API.
 *
 * Tokens live only in the encrypted settings secret store. Logs carry event names and HTTP
 * status codes only — never tokens, codes, state, account ids or URLs with parameters.
 */
import {
  AiDecision,
  type AiConnection,
  type AiModelList,
  type AiSettings,
  type AiTestResult,
} from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import type { AiPrompt, AiProvider } from './provider-types.js';
import { AI_OUTPUT_SCHEMA, generateOpenAi } from './provider.js';
import {
  LOGIN_TIMEOUT_MS,
  OAuthError,
  buildAuthorizeUrl,
  createPkce,
  createState,
  exchangeCode,
  parseCallbackUrl,
  refreshTokens,
  startCallbackListener,
  stateMatches,
  type CallbackListener,
  type ChatGptTokens,
} from './chatgpt-oauth.js';
import {
  BackendError,
  fallbackModels,
  fetchModels,
  streamResponse,
  type BackendModel,
} from './chatgpt-backend.js';

export const CHATGPT_TOKENS_SECRET = 'ai_chatgpt_direct_tokens';
const MODEL_CACHE_MS = 10 * 60_000;
const REFRESH_MARGIN_MS = 2 * 60_000;
export const SIGN_IN_AGAIN = 'ChatGPT sign-in expired. Sign in again.';
export const CHATGPT_BLOCKED =
  'ChatGPT stopped accepting this connection. It may have changed or been blocked. Use an OpenAI API key, or try Test connection later.';
const isBlocked = (error: unknown) =>
  error instanceof BackendError &&
  (error.status === 403 || error.status === 404 || error.unexpected);

interface PendingLogin {
  url: string;
  state: string;
  verifier: string;
  listener: CallbackListener;
  timer: ReturnType<typeof setTimeout>;
  /** Set once a code is being exchanged: the listener and a pasted address never both exchange. */
  exchanging: boolean;
}

export interface DirectDeps {
  fetch?: typeof fetch;
  callbackPort?: number;
  loginTimeoutMs?: number;
}

const aborted = () => new DOMException('AI reply cancelled', 'AbortError');

export class DirectChatGptProvider implements AiProvider {
  private pending: PendingLogin | null = null;
  private starting: Promise<AiConnection> | null = null;
  private closing: Promise<void> = Promise.resolve();
  /** Last sign-in attempt failure (shown; it does not stop a working connection). */
  private loginError: string | null = null;
  /** Connection-level failure: refresh token rejected, or ChatGPT blocked/changed the endpoint. */
  private problem: { state: 'expired' | 'error'; message: string } | null = null;
  private refreshing: Promise<ChatGptTokens> | null = null;
  private modelCache: { at: number; models: BackendModel[] } | null = null;
  /** Bumped on sign-in/out so late refreshes or answers never resurrect old credentials. */
  private epoch = 0;
  private readonly inflight = new Set<AbortController>();
  private readonly log;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly ctx: AppContext,
    private readonly deps: DirectDeps = {},
  ) {
    this.log = ctx.log.child({ mod: 'ai', provider: 'chatgpt-direct' });
    this.fetchImpl = deps.fetch ?? ((...args) => fetch(...args));
  }

  private tokens(): ChatGptTokens | null {
    const raw = this.ctx.settings.getSecret(CHATGPT_TOKENS_SECRET);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as ChatGptTokens;
      return value.accessToken && value.refreshToken && value.accountId ? value : null;
    } catch {
      return null;
    }
  }

  private saveTokens(tokens: ChatGptTokens | null) {
    this.ctx.settings.setSecret(CHATGPT_TOKENS_SECRET, tokens ? JSON.stringify(tokens) : null);
  }

  connection(): AiConnection {
    if (this.pending)
      return { state: 'signing_in', loginUrl: this.pending.url, error: null, email: null };
    const tokens = this.tokens();
    if (tokens && this.problem)
      return {
        state: this.problem.state,
        loginUrl: null,
        error: this.problem.message,
        email: tokens.email,
      };
    if (tokens)
      return { state: 'connected', loginUrl: null, error: this.loginError, email: tokens.email };
    if (this.loginError)
      return { state: 'error', loginUrl: null, error: this.loginError, email: null };
    return { state: 'signed_out', loginUrl: null, error: null, email: null };
  }

  private setProblem(state: 'expired' | 'error', message: string) {
    if (this.problem?.message !== message)
      this.log.warn(
        { event: state === 'expired' ? 'chatgpt_signin_expired' : 'chatgpt_connection_blocked' },
        'ChatGPT connection unavailable',
      );
    this.problem = { state, message };
  }

  /** Only one sign-in at a time: a new request cancels the previous one (its link stops working). */
  async login(): Promise<AiConnection> {
    this.starting ??= (async () => {
      if (this.pending) this.endLogin(this.pending, null);
      await this.closing;
      return this.beginLogin();
    })().finally(() => (this.starting = null));
    return this.starting;
  }

  private async beginLogin(): Promise<AiConnection> {
    const { verifier, challenge } = createPkce();
    const state = createState();
    let listener: CallbackListener;
    try {
      listener = await startCallbackListener(state, this.deps.callbackPort);
    } catch (error) {
      this.log.warn({ event: 'chatgpt_login_listener_failed' }, 'ChatGPT sign-in listener failed');
      throw error;
    }
    const pending: PendingLogin = {
      url: buildAuthorizeUrl(challenge, state),
      state,
      verifier,
      listener,
      exchanging: false,
      timer: setTimeout(
        () => this.endLogin(pending, 'ChatGPT sign-in timed out. Try again.'),
        this.deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS,
      ),
    };
    pending.timer.unref?.();
    this.pending = pending;
    this.loginError = null;
    this.log.info({ event: 'chatgpt_login_started' }, 'ChatGPT sign-in started');
    void this.completeLogin(pending);
    return this.connection();
  }

  private async completeLogin(pending: PendingLogin) {
    const result = await pending.listener.result;
    if (this.pending !== pending || pending.exchanging) return;
    if (!('code' in result)) {
      this.endLogin(pending, 'ChatGPT sign-in was cancelled. Try again.');
      return;
    }
    await this.exchange(pending, result.code, 'listener');
  }

  private async exchange(pending: PendingLogin, code: string, via: 'listener' | 'paste') {
    pending.exchanging = true;
    try {
      const tokens = await exchangeCode(code, pending.verifier, this.fetchImpl);
      if (this.pending !== pending) return;
      this.epoch++;
      this.modelCache = null;
      this.saveTokens(tokens);
      this.problem = null;
      pending.listener.finish(true);
      this.log.info({ event: 'chatgpt_login_completed', via }, 'ChatGPT signed in');
      this.endLogin(pending, null);
    } catch (error) {
      this.log.warn(
        {
          event: 'chatgpt_login_exchange_failed',
          via,
          status: error instanceof OAuthError ? error.status : null,
        },
        'ChatGPT sign-in failed',
      );
      pending.listener.finish(false);
      this.endLogin(
        pending,
        error instanceof OAuthError ? error.message : 'ChatGPT sign-in failed. Try again.',
      );
    }
  }

  /**
   * Remote-admin fallback: the admin pastes the final redirect address from their own browser.
   * Checked and exchanged exactly as the loopback listener would.
   */
  async submitCallbackUrl(raw: string): Promise<AiConnection> {
    const reject = (reason: string, message: string): never => {
      this.log.info({ event: 'chatgpt_login_paste_rejected', reason }, 'Pasted sign-in rejected');
      throw new OAuthError(message);
    };
    const pending = this.pending;
    if (!pending) return reject('none', 'No ChatGPT sign-in is in progress. Start sign-in again.');
    const parsed = parseCallbackUrl(raw);
    if (!parsed)
      return reject(
        'format',
        'Paste the full address that starts with http://localhost:1455/auth/callback.',
      );
    // A wrong or stale address must not cancel the real sign-in (same rule as the listener).
    if (!stateMatches(pending.state, parsed.state))
      return reject('state', 'This address is from another sign-in attempt. Start sign-in again.');
    if (pending.exchanging) return reject('busy', 'ChatGPT sign-in is already finishing.');
    if (parsed.error || !parsed.code) {
      this.endLogin(pending, 'ChatGPT sign-in was cancelled. Try again.');
      return this.connection();
    }
    await this.exchange(pending, parsed.code, 'paste');
    return this.connection();
  }

  private endLogin(pending: PendingLogin, error: string | null) {
    if (this.pending !== pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    this.closing = pending.listener.close();
    this.loginError = error;
    if (error)
      this.log.info({ event: 'chatgpt_login_ended', reason: error }, 'ChatGPT sign-in ended');
  }

  async logout(): Promise<void> {
    if (this.pending) this.endLogin(this.pending, null);
    this.epoch++;
    for (const controller of this.inflight) controller.abort();
    this.inflight.clear();
    this.saveTokens(null);
    this.modelCache = null;
    this.problem = null;
    this.loginError = null;
    this.log.info({ event: 'chatgpt_logout' }, 'ChatGPT signed out');
  }

  private async auth(): Promise<ChatGptTokens> {
    const tokens = this.tokens();
    if (!tokens) throw new Error('Sign in to ChatGPT in the AI settings.');
    if (tokens.expiresAt - REFRESH_MARGIN_MS > Date.now()) return tokens;
    return this.refresh(tokens);
  }

  private refresh(stale: ChatGptTokens): Promise<ChatGptTokens> {
    // A concurrent request may already have rotated the refresh token. Reuse its fresh tokens:
    // sending the spent refresh token again is rejected and would sign the inbox out.
    const current = this.tokens();
    if (
      current &&
      current.accessToken !== stale.accessToken &&
      current.expiresAt - REFRESH_MARGIN_MS > Date.now()
    )
      return Promise.resolve(current);
    const epoch = this.epoch;
    this.refreshing ??= refreshTokens(current ?? stale, this.fetchImpl)
      .then((next) => {
        if (epoch !== this.epoch) throw new Error('ChatGPT signed out.');
        this.saveTokens(next);
        if (this.problem?.state === 'expired') this.problem = null;
        this.log.info({ event: 'chatgpt_token_refreshed' }, 'ChatGPT token refreshed');
        return next;
      })
      .catch((error: unknown) => {
        const status = error instanceof OAuthError ? error.status : null;
        this.log.warn({ event: 'chatgpt_token_refresh_failed', status }, 'ChatGPT refresh failed');
        if (epoch === this.epoch && (status === 400 || status === 401)) {
          this.setProblem('expired', SIGN_IN_AGAIN);
          throw new Error(SIGN_IN_AGAIN);
        }
        throw error;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  /** Runs a backend call, refreshing once on 401. */
  private async withAuth<T>(call: (tokens: ChatGptTokens) => Promise<T>): Promise<T> {
    const tokens = await this.auth();
    try {
      return await call(tokens);
    } catch (error) {
      if (!(error instanceof BackendError) || error.status !== 401) throw error;
      const fresh = await this.refresh(tokens);
      try {
        return await call(fresh);
      } catch (retryError) {
        // A token that was just refreshed and is still refused means the sign-in is gone.
        if (retryError instanceof BackendError && retryError.status === 401)
          this.setProblem('expired', SIGN_IN_AGAIN);
        throw retryError;
      }
    }
  }

  private async liveModels(): Promise<BackendModel[] | null> {
    if (this.modelCache && Date.now() - this.modelCache.at < MODEL_CACHE_MS)
      return this.modelCache.models;
    if (!this.tokens()) return null;
    const epoch = this.epoch;
    try {
      const models = await this.withAuth((tokens) => fetchModels(tokens, this.fetchImpl));
      if (epoch === this.epoch) this.modelCache = { at: Date.now(), models };
      return models;
    } catch (error) {
      this.log.warn(
        {
          event: 'chatgpt_models_failed',
          status: error instanceof BackendError ? error.status : null,
        },
        'ChatGPT model list unavailable; using the fallback list',
      );
      return null;
    }
  }

  async models(): Promise<AiModelList> {
    const live = await this.liveModels();
    return {
      models: (live ?? fallbackModels()).map(({ id, label }) => ({ id, label })),
      source: live ? 'live' : 'fallback',
    };
  }

  /** Synchronous validation list: the cached live list, else the documented fallback. */
  knownModels(): readonly string[] {
    return (this.modelCache?.models ?? fallbackModels()).map((model) => model.id);
  }

  private async resolveModel(model: string): Promise<string> {
    if (model) return model;
    return ((await this.liveModels()) ?? fallbackModels())[0]!.id;
  }

  private async complete(
    model: string,
    prompt: AiPrompt,
    schema: Record<string, unknown> | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const controller = new AbortController();
    this.inflight.add(controller);
    const started = Date.now();
    const bounded = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(60_000)]);
    try {
      const text = await this.withAuth((tokens) =>
        streamResponse(
          tokens,
          { model, instructions: prompt.instructions, input: prompt.input, schema },
          bounded,
          this.fetchImpl,
        ),
      );
      // ChatGPT answers again: a blocked state is over (an expired sign-in needs a new sign-in).
      if (this.problem?.state === 'error') this.problem = null;
      this.log.debug(
        { event: 'chatgpt_answer_completed', model, ms: Date.now() - started },
        'ChatGPT answered',
      );
      return text;
    } catch (error) {
      if (signal.aborted || controller.signal.aborted) throw aborted();
      if (bounded.aborted) throw new Error('ChatGPT answer timed out.', { cause: error });
      const status = error instanceof BackendError ? error.status : null;
      this.log.warn(
        { event: 'chatgpt_answer_failed', status, model, ms: Date.now() - started },
        'ChatGPT answer failed',
      );
      if (isBlocked(error)) {
        this.setProblem('error', CHATGPT_BLOCKED);
        throw new BackendError(CHATGPT_BLOCKED, status);
      }
      throw error;
    } finally {
      this.inflight.delete(controller);
    }
  }

  async generate(
    settings: AiSettings,
    apiKey: string | null,
    prompt: AiPrompt,
    signal: AbortSignal,
  ): Promise<AiDecision> {
    if (settings.mode === 'api') return generateOpenAi(settings, apiKey, prompt, signal);
    const model = await this.resolveModel(settings.model);
    const text = await this.complete(model, prompt, AI_OUTPUT_SCHEMA, signal);
    try {
      return AiDecision.parse(JSON.parse(text));
    } catch {
      throw new Error('ChatGPT returned an invalid answer.');
    }
  }

  async test(savedModel: string): Promise<AiTestResult> {
    let model: string | null = null;
    try {
      model = await this.resolveModel(savedModel);
      const reply = await this.complete(
        model,
        { instructions: 'You are a connection test. Reply with OK.', input: 'Reply with OK' },
        undefined,
        AbortSignal.timeout(60_000),
      );
      return { ok: true, model, reply: reply.trim().slice(0, 200), error: null };
    } catch (error) {
      return {
        ok: false,
        model,
        reply: null,
        error: error instanceof Error ? error.message : 'ChatGPT could not answer.',
      };
    }
  }

  async shutdown() {
    if (this.pending) this.endLogin(this.pending, null);
    for (const controller of this.inflight) controller.abort();
    this.inflight.clear();
  }
}
