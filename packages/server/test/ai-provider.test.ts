import type { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiSettings } from '@wa-team-inbox/shared';
import type { AppContext } from '../src/context.js';
import { BusinessAiProvider, generateOpenAi } from '../src/ai/provider.js';
import {
  CHATGPT_MODELS,
  codexEnvironment,
  safeCodexConfig,
  safeModelCatalog,
} from '../src/ai/codex-config.js';

const helpers = vi.hoisted(() => ({
  constructors: vi.fn(),
  request: vi.fn(),
  instances: [] as EventEmitter[],
}));
vi.mock('../src/ai/codex-client.js', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    CODEX_ERROR: 'Safe connection error',
    CodexClient: class extends Emitter {
      constructor(...args: unknown[]) {
        super();
        helpers.constructors(...args);
        helpers.instances.push(this);
      }
      initialize = vi.fn().mockResolvedValue(undefined);
      request = helpers.request;
      close() {
        this.emit('closed');
      }
    },
  };
});

const settings: AiSettings = {
  enabled: true,
  displayName: 'AI',
  mode: 'api',
  model: '',
  instructions: '',
  notes: '',
  faqs: [],
};
const prompt = {
  instructions: 'Only answer from supplied business knowledge',
  input: 'Opening hours?',
};
let directories: string[] = [];
const providers: BusinessAiProvider[] = [];
beforeEach(() => {
  helpers.request.mockReset();
  helpers.constructors.mockClear();
  helpers.instances.length = 0;
  helpers.request.mockImplementation(async (method: string) =>
    method === 'account/read'
      ? { account: { type: 'chatgpt' } }
      : method === 'thread/start'
        ? { thread: { id: 'thread-1' } }
        : method === 'turn/start'
          ? { turn: { id: 'turn-1' } }
          : {},
  );
});
afterEach(async () => {
  for (const provider of providers.splice(0)) await provider.shutdown();
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories = [];
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function makeProvider() {
  const dataDir = mkdtempSync(join(tmpdir(), 'ai-provider-'));
  directories.push(dataDir);
  const executable = join(dataDir, 'codex');
  writeFileSync(executable, 'mock helper');
  vi.stubEnv('WATI_CODEX', executable);
  const provider = new BusinessAiProvider({
    config: { dataDir },
    settings: {
      get: (key: string) => (key === 'ai_inbox_provider' ? { mode: 'chatgpt' } : true),
      set: vi.fn(),
    },
  } as unknown as AppContext);
  providers.push(provider);
  return { provider, dataDir };
}
async function connected() {
  const result = makeProvider();
  await vi.waitFor(() => expect(result.provider.connection().state).toBe('connected'));
  return result;
}

describe('OpenAI Responses provider', () => {
  it('uses the official fixed endpoint, private structured output and no tools', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"reply":"9am to 5pm","action":"answer"}' }],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(
      await generateOpenAi(settings, 'sk-test-secret', prompt, new AbortController().signal),
    ).toEqual({ reply: '9am to 5pm', action: 'answer' });
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(request.redirect).toBe('error');
    expect(JSON.parse(request.body)).toMatchObject({
      model: 'gpt-4.1-mini',
      tools: [],
      store: false,
      instructions: prompt.instructions,
      text: { format: { strict: true, type: 'json_schema' } },
    });
  });
  it('does not call the provider without a key or after cancellation', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      generateOpenAi(settings, null, prompt, new AbortController().signal),
    ).rejects.toThrow('API key');
    const abort = new AbortController();
    abort.abort();
    await expect(generateOpenAi(settings, 'sk-secret', prompt, abort.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500])(
    'sanitizes HTTP %i errors without parsing or echoing raw bodies',
    async (status) => {
      const response = new Response('SECRET provider body and customer text', { status });
      const json = vi.spyOn(response, 'json');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      await expect(
        generateOpenAi(settings, 'sk-secret', prompt, new AbortController().signal),
      ).rejects.not.toThrow('SECRET');
      expect(json).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid decisions and incomplete responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [
                  { type: 'output_text', text: '{"reply":"invented","action":"delete_files"}' },
                ],
              },
            ],
          }),
        ),
      ),
    );
    await expect(
      generateOpenAi(settings, 'key', prompt, new AbortController().signal),
    ).rejects.toThrow('invalid answer');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'incomplete', output: [] }))),
    );
    await expect(
      generateOpenAi(settings, 'key', prompt, new AbortController().signal),
    ).rejects.toThrow('did not complete');
  });
  it('cancels in-flight HTTP generation without echoing fetch error details', async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async (_url, request) =>
            new Promise((_resolve, reject) =>
              request.signal.addEventListener('abort', () =>
                reject(new Error('Secret API details')),
              ),
            ),
        ),
    );
    const result = generateOpenAi(settings, 'key', prompt, abort.signal);
    abort.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('restricted ChatGPT integration', () => {
  it('does not launch or inspect ChatGPT credentials for the default API mode', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ai-provider-api-'));
    directories.push(dataDir);
    const executable = join(dataDir, 'codex');
    writeFileSync(executable, 'mock');
    vi.stubEnv('WATI_CODEX', executable);
    const provider = new BusinessAiProvider({
      config: { dataDir },
      settings: { get: (key: string) => (key === 'ai_inbox_provider' ? { mode: 'api' } : true) },
    } as unknown as AppContext);
    providers.push(provider);
    expect(provider.connection().state).toBe('signed_out');
    expect(helpers.constructors).not.toHaveBeenCalled();
    expect(helpers.request).not.toHaveBeenCalled();
  });
  it('locks filesystem tool metadata and uses encrypted keyring-only credentials', () => {
    const config = safeCodexConfig('/private/catalog.json');
    expect(config).toMatchObject({
      cli_auth_credentials_store: 'keyring',
      forced_login_method: 'chatgpt',
      mcp_servers: {},
      project_doc_max_bytes: 0,
      web_search: 'disabled',
      tools: { view_image: false },
      features: {
        shell_tool: false,
        apply_patch_freeform: false,
        multi_agent: false,
        apps: false,
        js_repl: false,
        code_mode: false,
        artifact: false,
        request_permissions: false,
      },
    });
    for (const model of safeModelCatalog().models)
      expect(model).toMatchObject({
        shell_type: 'disabled',
        apply_patch_tool_type: null,
        experimental_supported_tools: [],
        input_modalities: ['text'],
      });
    expect(safeModelCatalog().models.map((model) => model.slug)).toEqual(CHATGPT_MODELS);
  });
  it('isolates child homes and does not pass host credentials, PATH, config or hooks', () => {
    const env = codexEnvironment('/app/private', '/app/private/codex', {
      HOME: '/user',
      CODEX_HOME: '/platform',
      OPENAI_API_KEY: 'host-key',
      PATH: '/host/tools',
      CODEX_CONFIG: 'host-config',
      GITHUB_TOKEN: 'token',
      HTTP_PROXY: 'http://proxy',
    });
    expect(env).toMatchObject({
      HOME: '/app/private',
      USERPROFILE: '/app/private',
      CODEX_HOME: '/app/private/codex',
      PATH: '',
      HTTP_PROXY: 'http://proxy',
    });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.CODEX_CONFIG).toBeUndefined();
  });
  it('restores only the app namespace and writes an authoritative safe catalog', async () => {
    const { dataDir } = await connected();
    const [binary, args, cwd, env] = helpers.constructors.mock.calls[0]!;
    expect(binary).toBe(join(dataDir, 'codex'));
    expect(args[0]).toBe('app-server');
    expect(args).toContain('cli_auth_credentials_store="keyring"');
    expect(cwd).toBe(join(dataDir, 'ai-runtime/workspace'));
    expect(env.CODEX_HOME).toBe(join(dataDir, 'ai-runtime/codex'));
    expect(
      JSON.parse(readFileSync(join(dataDir, 'ai-runtime/codex/business-models.json'), 'utf8')),
    ).toEqual(safeModelCatalog());
  });
  it('rejects arbitrary model names before any generation (no unsafe fallback metadata)', async () => {
    const { provider } = await connected();
    await expect(
      provider.generate(
        { ...settings, mode: 'chatgpt', model: 'gpt-unknown' },
        null,
        prompt,
        new AbortController().signal,
      ),
    ).rejects.toThrow('supports');
    expect(helpers.request).not.toHaveBeenCalledWith('thread/start', expect.anything());
  });
  it('runs isolated ephemeral text-only threads and validates the final decision', async () => {
    const { provider } = await connected();
    const generated = provider.generate(
      { ...settings, mode: 'chatgpt' },
      null,
      prompt,
      new AbortController().signal,
    );
    await vi.waitFor(() =>
      expect(helpers.request).toHaveBeenCalledWith('turn/start', expect.anything()),
    );
    expect(helpers.request).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({
        ephemeral: true,
        sandbox: 'read-only',
        baseInstructions: prompt.instructions,
        model: 'gpt-5.4',
      }),
    );
    helpers.instances[0]!.emit('notification', 'item/completed', {
      threadId: 'thread-1',
      item: { type: 'agentMessage', text: '{"reply":"Welcome","action":"answer"}' },
    });
    helpers.instances[0]!.emit('notification', 'turn/completed', {
      threadId: 'thread-1',
      turn: { status: 'completed' },
    });
    await expect(generated).resolves.toEqual({ reply: 'Welcome', action: 'answer' });
  });
  it('interrupts generation on human takeover and ignores subsequent completion', async () => {
    const { provider } = await connected();
    const abort = new AbortController();
    const generated = provider.generate(
      { ...settings, mode: 'chatgpt' },
      null,
      prompt,
      abort.signal,
    );
    await vi.waitFor(() =>
      expect(helpers.request).toHaveBeenCalledWith('turn/start', expect.anything()),
    );
    abort.abort();
    await expect(generated).rejects.toMatchObject({ name: 'AbortError' });
    expect(helpers.request).toHaveBeenCalledWith('turn/interrupt', {
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
    helpers.instances[0]!.emit('notification', 'turn/completed', {
      threadId: 'thread-1',
      turn: { status: 'completed' },
    });
  });
  it('never starts a turn when ownership changes during thread creation', async () => {
    const { provider } = await connected();
    const abort = new AbortController();
    let finishThread: (value: unknown) => void = () => {};
    helpers.request.mockImplementation(async (method: string) =>
      method === 'thread/start'
        ? new Promise((resolve) => {
            finishThread = resolve;
          })
        : {},
    );
    const generated = provider.generate(
      { ...settings, mode: 'chatgpt' },
      null,
      prompt,
      abort.signal,
    );
    await vi.waitFor(() =>
      expect(helpers.request).toHaveBeenCalledWith('thread/start', expect.anything()),
    );
    abort.abort();
    finishThread({ thread: { id: 'thread-1' } });
    await expect(generated).rejects.toMatchObject({ name: 'AbortError' });
    expect(helpers.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
  });
  it('returns only a supported login URL and clears it after successful sign-in', async () => {
    helpers.request.mockImplementation(async (method: string) =>
      method === 'account/read'
        ? { account: null }
        : {
            authUrl: 'https://auth.openai.com/oauth/authorize?state=private-state',
            loginId: 'login-1',
          },
    );
    const { provider } = makeProvider();
    expect(await provider.login()).toEqual({
      state: 'signing_in',
      loginUrl: 'https://auth.openai.com/oauth/authorize?state=private-state',
      error: null,
    });
    helpers.instances[0]!.emit('notification', 'account/login/completed', {
      loginId: 'login-1',
      success: true,
    });
    expect(provider.connection()).toEqual({ state: 'connected', loginUrl: null, error: null });
  });
  it('rejects unexpected login hosts and sanitizes provider login errors', async () => {
    helpers.request.mockImplementation(async (method: string) =>
      method === 'account/read'
        ? { account: null }
        : { authUrl: 'https://evil.example/credential', loginId: 'login-1' },
    );
    const { provider } = makeProvider();
    await expect(provider.login()).rejects.toThrow('Safe connection error');
    expect(provider.connection()).toEqual({
      state: 'error',
      loginUrl: null,
      error: 'Safe connection error',
    });
  });
  it('cancels login and removes the app account on logout', async () => {
    helpers.request.mockImplementation(async (method: string) =>
      method === 'account/read'
        ? { account: null }
        : { authUrl: 'https://auth.openai.com/login', loginId: 'login-1' },
    );
    const { provider } = makeProvider();
    await provider.login();
    await provider.logout();
    expect(helpers.request).toHaveBeenCalledWith('account/login/cancel', { loginId: 'login-1' });
    expect(helpers.request).toHaveBeenCalledWith('account/logout');
    expect(provider.connection().state).toBe('signed_out');
  });
  it('does not start customer generation during sign-out', async () => {
    const { provider } = await connected();
    let finishLogout: (value: unknown) => void = () => {};
    helpers.request.mockImplementation(async (method: string) =>
      method === 'account/logout'
        ? new Promise((resolve) => {
            finishLogout = resolve;
          })
        : {},
    );
    const logout = provider.logout();
    await vi.waitFor(() => expect(helpers.request).toHaveBeenCalledWith('account/logout'));
    await expect(
      provider.generate(
        { ...settings, mode: 'chatgpt' },
        null,
        prompt,
        new AbortController().signal,
      ),
    ).rejects.toThrow('signing out');
    finishLogout({});
    await logout;
    expect(helpers.request).not.toHaveBeenCalledWith('thread/start', expect.anything());
  });
});
