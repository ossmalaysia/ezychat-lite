import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const CHATGPT_MODELS = ['gpt-5.4', 'gpt-5.3-codex'] as const;
export const DEFAULT_CHATGPT_MODEL = CHATGPT_MODELS[0];
export const CODEX_PROTOCOL_VERSION = '0.114.0';

/** Codex 0.114.0 uses model metadata for apply_patch and local image reads. Feature flags
 * alone do not disable these. A custom catalog is authoritative (no remote refresh).
 * Text-only metadata makes view_image reject BEFORE reading any local file. */
export function safeModelCatalog() {
  return {
    models: CHATGPT_MODELS.map((slug) => ({
      slug,
      display_name: slug,
      description: 'Business question answering',
      default_reasoning_level: 'low',
      supported_reasoning_levels: [{ effort: 'low', description: 'Brief answers' }],
      shell_type: 'disabled',
      visibility: 'list',
      supported_in_api: true,
      priority: 0,
      availability_nux: null,
      upgrade: null,
      base_instructions: 'Answer business questions using the supplied knowledge.',
      supports_reasoning_summaries: false,
      support_verbosity: false,
      default_verbosity: null,
      apply_patch_tool_type: null,
      truncation_policy: { mode: 'tokens', limit: 30000 },
      supports_parallel_tool_calls: false,
      experimental_supported_tools: [],
      input_modalities: ['text'],
      context_window: 272000,
      prefer_websockets: false,
    })),
  };
}

export function safeCodexConfig(catalogPath: string) {
  return {
    model_catalog_json: catalogPath,
    model: DEFAULT_CHATGPT_MODEL,
    cli_auth_credentials_store: 'keyring',
    forced_login_method: 'chatgpt',
    sandbox_mode: 'read-only',
    approval_policy: 'untrusted',
    project_doc_max_bytes: 0,
    web_search: 'disabled',
    mcp_servers: {},
    tools: { view_image: false },
    history: { persistence: 'none' },
    features: {
      shell_tool: false,
      unified_exec: false,
      shell_zsh_fork: false,
      shell_snapshot: false,
      apply_patch_freeform: false,
      apps: false,
      multi_agent: false,
      plugins: false,
      codex_hooks: false,
      js_repl: false,
      code_mode: false,
      artifact: false,
      image_generation: false,
      request_permissions: false,
      request_permissions_tool: false,
      default_mode_request_user_input: false,
      memories: false,
      sqlite: false,
      undo: false,
    },
    analytics: { enabled: false },
    feedback: { enabled: false },
  };
}

/** Never inherit the host's Codex home, OpenAI key, config, skills or MCP credentials.
 * OS keyring credentials are scoped by the app-owned Codex home. */
export function codexEnvironment(
  privateHome: string,
  codexHome: string,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    HOME: privateHome,
    USERPROFILE: privateHome,
    CODEX_HOME: codexHome,
    PATH: '',
    NO_COLOR: '1',
    RUST_LOG: 'off',
  };
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR',
  ]) {
    if (inherited[key]) result[key] = inherited[key];
  }
  return result;
}

function isFile(path: string) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Explicit development override or packaged resources only; never search PATH. The service
 * server bundle is resources/app.asar.unpacked/dist/server/server.cjs on both OSes. */
export function resolveCodexBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.WATI_CODEX && isFile(env.WATI_CODEX)) return resolve(env.WATI_CODEX);
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const candidates = [
    join(dirname(process.argv[1] ?? ''), '../../../codex', name),
    // Standalone Electron invokes dist/server-host.cjs; OS services invoke dist/server/server.cjs.
    join(dirname(process.argv[1] ?? ''), '../../codex', name),
    join(process.cwd(), 'resources/codex', `${process.platform}-${process.arch}`, name),
  ];
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resources) candidates.unshift(join(resources, 'codex', name));
  return candidates.find(isFile) ?? null;
}
