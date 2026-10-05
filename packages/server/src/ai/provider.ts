import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiDecision, type AiConnection, type AiSettings } from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import type { AiPrompt, AiProvider } from './provider-types.js';
import { CodexClient, CODEX_ERROR } from './codex-client.js';
import {
  CHATGPT_MODELS,
  DEFAULT_CHATGPT_MODEL,
  codexEnvironment,
  resolveCodexBinary,
  safeCodexConfig,
  safeModelCatalog,
} from './codex-config.js';

export const AI_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    action: { type: 'string', enum: ['answer', 'ask_resolution', 'resolve', 'handoff'] },
  },
  required: ['reply', 'action'],
  additionalProperties: false,
};

function parseDecision(value: string) {
  try {
    return AiDecision.parse(JSON.parse(value));
  } catch {
    throw new Error('The AI returned an invalid answer.');
  }
}

const aborted = () => new DOMException('AI reply cancelled', 'AbortError');

export async function generateOpenAi(
  settings: AiSettings,
  apiKey: string | null,
  prompt: AiPrompt,
  signal: AbortSignal,
): Promise<AiDecision> {
  if (!apiKey) throw new Error('Add an OpenAI API key in the AI member settings.');
  signal.throwIfAborted();
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      redirect: 'error',
      signal: boundedSignal,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: settings.model || 'gpt-4.1-mini',
        instructions: prompt.instructions,
        input: prompt.input,
        store: false,
        tools: [],
        text: {
          format: {
            type: 'json_schema',
            name: 'business_reply',
            strict: true,
            schema: AI_OUTPUT_SCHEMA,
          },
        },
        max_output_tokens: 2000,
      }),
    });
  } catch {
    if (signal.aborted) throw aborted();
    throw new Error('OpenAI could not answer. Check your connection and API settings.');
  }
  if (!response.ok) {
    // Do not include the body: upstream errors can echo credentials or customer content.
    await response.body?.cancel().catch(() => {});
    throw new Error(
      response.status === 401
        ? 'The OpenAI API key was rejected.'
        : response.status === 429
          ? 'OpenAI usage limit reached. Check your account or try again later.'
          : 'OpenAI could not answer. Check your API settings.',
    );
  }
  let result: {
    status?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  try {
    result = (await response.json()) as typeof result;
  } catch {
    throw new Error('OpenAI returned an invalid answer.');
  }
  signal.throwIfAborted();
  if (result.status !== 'completed') throw new Error('OpenAI did not complete its answer.');
  const text = result.output
    ?.filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('');
  return parseDecision(text ?? '');
}

type TurnWait = {
  threadId: string;
  resolve: (value: AiDecision) => void;
  reject: (error: Error) => void;
  text: string;
  cleanup: () => void;
};

export class BusinessAiProvider implements AiProvider {
  private client: CodexClient | null = null;
  private starting: Promise<CodexClient> | null = null;
  private state: AiConnection;
  private readonly turns = new Map<string, TurnWait>();
  private readonly binary: string | null;
  private readonly home: string;
  private readonly codexHome: string;
  private readonly workspace: string;
  private loginId: string | null = null;
  private loginOperation: Promise<AiConnection> | null = null;
  private loggingOut = false;
  private shuttingDown = false;

  constructor(private readonly ctx: AppContext) {
    this.binary = resolveCodexBinary();
    this.home = join(ctx.config.dataDir, 'ai-runtime');
    this.codexHome = join(this.home, 'codex');
    this.workspace = join(this.home, 'workspace');
    this.state = {
      state: this.binary ? 'signed_out' : 'unavailable',
      loginUrl: null,
      error: this.binary
        ? null
        : 'ChatGPT helper is unavailable. Use the desktop installer or configure WATI_CODEX for development.',
    };
    // Restoration reads only the app's OS keyring namespace; never the host's Codex auth.
    this.restoreIfNeeded();
  }

  connection(): AiConnection {
    this.restoreIfNeeded();
    return { ...this.state };
  }

  private restoreIfNeeded() {
    if (
      this.binary &&
      !this.client &&
      !this.starting &&
      !this.shuttingDown &&
      !this.loggingOut &&
      this.state.state === 'signed_out' &&
      this.ctx.settings.get('ai.chatgpt_linked', false) &&
      this.ctx.settings.get<{ mode: string }>('ai_inbox_provider', { mode: 'api' }).mode ===
        'chatgpt'
    ) {
      void this.ready().catch(() => this.setError());
    }
  }

  private setError() {
    this.state = { state: 'error', loginUrl: null, error: CODEX_ERROR };
  }

  private async ready(): Promise<CodexClient> {
    if (this.shuttingDown) throw new Error(CODEX_ERROR);
    if (this.starting) return this.starting;
    if (this.client) return this.client;
    if (!this.binary) throw new Error(this.state.error!);
    this.starting = (async () => {
      for (const path of [this.home, this.codexHome, this.workspace])
        mkdirSync(path, { recursive: true, mode: 0o700 });
      const catalog = join(this.codexHome, 'business-models.json');
      writeFileSync(catalog, JSON.stringify(safeModelCatalog()), { mode: 0o600 });
      const config = safeCodexConfig(catalog);
      const args = [
        'app-server',
        ...Object.entries(config).flatMap(([key, value]) => ['-c', `${key}=${toml(value)}`]),
      ];
      writeFileSync(
        join(this.codexHome, 'config.toml'),
        Object.entries(config)
          .map(([key, value]) => `${key} = ${toml(value)}`)
          .join('\n'),
        { mode: 0o600 },
      );
      const client = new CodexClient(
        this.binary!,
        args,
        this.workspace,
        codexEnvironment(this.home, this.codexHome),
      );
      this.client = client;
      client.on('notification', (method: string, params: Record<string, unknown>) =>
        this.notification(method, params),
      );
      client.on('closed', () => {
        if (this.client !== client) return;
        this.client = null;
        if (!this.shuttingDown) this.setError();
        for (const turn of this.turns.values()) {
          turn.cleanup();
          turn.reject(new Error(CODEX_ERROR));
        }
        this.turns.clear();
      });
      await client.initialize();
      const account = await client.request('account/read', { refreshToken: false });
      this.state = {
        state:
          (account.account as { type?: string } | null)?.type === 'chatgpt'
            ? 'connected'
            : 'signed_out',
        loginUrl: null,
        error: null,
      };
      return client;
    })();
    try {
      return await this.starting;
    } catch {
      (this.client as CodexClient | null)?.close();
      this.setError();
      throw new Error(CODEX_ERROR);
    } finally {
      this.starting = null;
    }
  }

  private notification(method: string, params: Record<string, unknown>) {
    if (this.shuttingDown || this.loggingOut) return;
    if (method === 'account/login/completed') {
      if (params.loginId !== this.loginId) return;
      this.loginId = null;
      this.state = {
        state: params.success ? 'connected' : 'error',
        loginUrl: null,
        error: params.success ? null : CODEX_ERROR,
      };
      if (params.success) this.ctx.settings.set('ai.chatgpt_linked', true);
    } else if (method === 'account/updated') {
      if (this.state.state !== 'signing_in')
        this.state = {
          state: params.authMode === 'chatgpt' ? 'connected' : 'signed_out',
          loginUrl: null,
          error: null,
        };
    } else if (method === 'item/completed') {
      const turn = this.turns.get(String(params.threadId));
      const item = params.item as { type?: string; text?: string } | undefined;
      if (turn && item?.type === 'agentMessage') turn.text = item.text ?? '';
    } else if (method === 'turn/completed') {
      const turn = this.turns.get(String(params.threadId));
      if (!turn) return;
      this.turns.delete(turn.threadId);
      turn.cleanup();
      try {
        if ((params.turn as { status?: string } | undefined)?.status !== 'completed')
          throw new Error('ChatGPT did not complete its answer.');
        turn.resolve(parseDecision(turn.text));
      } catch {
        turn.reject(new Error('ChatGPT did not return a valid answer.'));
      }
      void this.client?.request('thread/archive', { threadId: turn.threadId }).catch(() => {});
    }
  }

  async login(): Promise<AiConnection> {
    if (this.loggingOut) throw new Error('ChatGPT is signing out. Try again after it finishes.');
    if (this.loginOperation) return this.loginOperation;
    this.loginOperation = this.beginLogin();
    try {
      return await this.loginOperation;
    } finally {
      this.loginOperation = null;
    }
  }

  private async beginLogin(): Promise<AiConnection> {
    const client = await this.ready();
    if (this.state.state === 'connected' || this.state.state === 'signing_in')
      return this.connection();
    try {
      const result = await client.request('account/login/start', { type: 'chatgpt' });
      const url = new URL(String(result.authUrl));
      if (
        url.protocol !== 'https:' ||
        !['auth.openai.com', 'chatgpt.com'].includes(url.hostname) ||
        url.username ||
        url.password ||
        (url.port && url.port !== '443') ||
        typeof result.loginId !== 'string'
      )
        throw new Error(CODEX_ERROR);
      this.loginId = result.loginId;
      this.state = { state: 'signing_in', loginUrl: url.toString(), error: null };
      return this.connection();
    } catch {
      this.setError();
      throw new Error(CODEX_ERROR);
    }
  }

  async logout(): Promise<void> {
    if (this.loggingOut) throw new Error('ChatGPT is already signing out.');
    this.loggingOut = true;
    try {
      await this.loginOperation?.catch(() => {});
      const client = await this.ready();
      this.state = { state: 'signed_out', loginUrl: null, error: null };
      if (this.loginId) await client.request('account/login/cancel', { loginId: this.loginId });
      this.loginId = null;
      // Kill active turns before clearing authentication; none may send afterwards.
      for (const turn of this.turns.values()) {
        turn.cleanup();
        turn.reject(aborted());
      }
      this.turns.clear();
      await client.request('account/logout');
      this.ctx.settings.set('ai.chatgpt_linked', false);
      client.close();
      this.state = { state: 'signed_out', loginUrl: null, error: null };
    } finally {
      this.loggingOut = false;
    }
  }

  async generate(
    settings: AiSettings,
    apiKey: string | null,
    prompt: AiPrompt,
    signal: AbortSignal,
  ): Promise<AiDecision> {
    if (settings.mode === 'api') return generateOpenAi(settings, apiKey, prompt, signal);
    if (this.loggingOut) throw new Error('ChatGPT is signing out.');
    signal.throwIfAborted();
    const model = settings.model || DEFAULT_CHATGPT_MODEL;
    if (!(CHATGPT_MODELS as readonly string[]).includes(model))
      throw new Error(`ChatGPT mode supports ${CHATGPT_MODELS.join(' or ')}.`);
    const client = await this.ready();
    signal.throwIfAborted();
    if (this.loggingOut) throw new Error('ChatGPT is signing out.');
    if (this.state.state !== 'connected')
      throw new Error('Sign in to ChatGPT in the AI member settings.');
    const result = await client.request('thread/start', {
      model,
      cwd: this.workspace,
      approvalPolicy: 'untrusted',
      sandbox: 'read-only',
      ephemeral: true,
      baseInstructions: prompt.instructions,
      developerInstructions:
        'No tools, commands, files, websites or integrations may be used. Return only the requested JSON business reply.',
    });
    const threadId = (result.thread as { id?: string } | undefined)?.id;
    if (!threadId) throw new Error(CODEX_ERROR);
    if (signal.aborted || this.loggingOut) {
      void client.request('thread/archive', { threadId }).catch(() => {});
      throw aborted();
    }
    return new Promise((resolve, reject) => {
      let cancelled = false;
      const cancel = (error: Error) => {
        const turn = this.turns.get(threadId);
        if (!turn) return;
        cancelled = true;
        this.turns.delete(threadId);
        turn.cleanup();
        // Interrupt immediately even when turn/start is still in flight. Close the helper on
        // interruption failure; stale customer generations must never remain alive.
        if (turnId)
          void client.request('turn/interrupt', { threadId, turnId }).catch(() => client.close());
        else client.close();
        reject(error);
      };
      let turnId = '';
      const onAbort = () => cancel(aborted());
      const timer = setTimeout(() => cancel(new Error('ChatGPT answer timed out.')), 60_000);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      };
      this.turns.set(threadId, { threadId, resolve, reject, text: '', cleanup });
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      void client
        .request('turn/start', {
          threadId,
          input: [{ type: 'text', text: prompt.input }],
          outputSchema: AI_OUTPUT_SCHEMA,
        })
        .then((started) => {
          turnId = String((started.turn as { id?: string } | undefined)?.id ?? '');
          if (cancelled)
            void client.request('turn/interrupt', { threadId, turnId }).catch(() => client.close());
        })
        .catch(() => cancel(new Error(CODEX_ERROR)));
    });
  }

  async shutdown() {
    this.shuttingDown = true;
    this.client?.close();
    await this.starting?.catch(() => {});
    this.client?.close();
  }
}

/** Minimal TOML encoder for the fixed private config; no customer strings enter config. */
function toml(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) return `[${value.map(toml).join(', ')}]`;
    return `{ ${Object.entries(value)
      .map(([key, item]) => `${key} = ${toml(item)}`)
      .join(', ')} }`;
  }
  return JSON.stringify(value);
}
