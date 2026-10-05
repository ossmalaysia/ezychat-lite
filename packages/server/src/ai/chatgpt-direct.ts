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
  refreshTokens,
  startCallbackListener,
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
const SIGN_IN_AGAIN = 'ChatGPT sign-in expired. Sign in again.';

interface PendingLogin {
  url: string;
  verifier: string;
  listener: CallbackListener;
  timer: ReturnType<typeof setTimeout>;
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
  private lastError: string | null = null;
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
    if (tokens && !this.lastError)
      return { state: 'connected', loginUrl: null, error: null, email: tokens.email };
    if (this.lastError)
      return {
        state: 'error',
        loginUrl: null,
        error: this.lastError,
        email: tokens?.email ?? null,
      };
    return { state: 'signed_out', loginUrl: null, error: null, email: null };
  }

  async login(): Promise<AiConnection> {
    if (this.pending) return this.connection();
    this.starting ??= this.beginLogin().finally(() => (this.starting = null));
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
      verifier,
      listener,
      timer: setTimeout(
        () => this.endLogin(pending, 'ChatGPT sign-in timed out. Try again.'),
        this.deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS,
      ),
    };
    pending.timer.unref?.();
    this.pending = pending;
    this.lastError = null;
    this.log.info({ event: 'chatgpt_login_started' }, 'ChatGPT sign-in started');
    void this.completeLogin(pending);
    return this.connection();
  }

  private async completeLogin(pending: PendingLogin) {
    const result = await pending.listener.result;
    if (this.pending !== pending) return;
    if (!('code' in result)) {
      this.endLogin(pending, 'ChatGPT sign-in was cancelled. Try again.');
      return;
    }
    try {
      const tokens = await exchangeCode(result.code, pending.verifier, this.fetchImpl);
      if (this.pending !== pending) return;
      this.epoch++;
      this.modelCache = null;
      this.saveTokens(tokens);
      pending.listener.finish(true);
      this.log.info({ event: 'chatgpt_login_completed' }, 'ChatGPT signed in');
      this.endLogin(pending, null);
    } catch (error) {
      this.log.warn(
        {
          event: 'chatgpt_login_exchange_failed',
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

  private endLogin(pending: PendingLogin, error: string | null) {
    if (this.pending !== pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.listener.close();
    this.lastError = error;
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
    this.lastError = null;
    this.log.info({ event: 'chatgpt_logout' }, 'ChatGPT signed out');
  }

  private async auth(): Promise<ChatGptTokens> {
    const tokens = this.tokens();
    if (!tokens) throw new Error('Sign in to ChatGPT in the AI settings.');
    if (tokens.expiresAt - REFRESH_MARGIN_MS > Date.now()) return tokens;
    return this.refresh(tokens);
  }

  private refresh(tokens: ChatGptTokens): Promise<ChatGptTokens> {
    const epoch = this.epoch;
    this.refreshing ??= refreshTokens(tokens, this.fetchImpl)
      .then((next) => {
        if (epoch !== this.epoch) throw new Error('ChatGPT signed out.');
        this.saveTokens(next);
        this.lastError = null;
        this.log.info({ event: 'chatgpt_token_refreshed' }, 'ChatGPT token refreshed');
        return next;
      })
      .catch((error: unknown) => {
        const status = error instanceof OAuthError ? error.status : null;
        this.log.warn({ event: 'chatgpt_token_refresh_failed', status }, 'ChatGPT refresh failed');
        if (epoch === this.epoch && (status === 400 || status === 401)) {
          this.lastError = SIGN_IN_AGAIN;
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
      return call(await this.refresh(tokens));
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
    const bounded = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(60_000)]);
    try {
      return await this.withAuth((tokens) =>
        streamResponse(
          tokens,
          { model, instructions: prompt.instructions, input: prompt.input, schema },
          bounded,
          this.fetchImpl,
        ),
      );
    } catch (error) {
      if (signal.aborted || controller.signal.aborted) throw aborted();
      if (bounded.aborted) throw new Error('ChatGPT answer timed out.', { cause: error });
      this.log.warn(
        {
          event: 'chatgpt_answer_failed',
          status: error instanceof BackendError ? error.status : null,
          model,
        },
        'ChatGPT answer failed',
      );
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
