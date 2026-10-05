import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { CODEX_PROTOCOL_VERSION } from './codex-config.js';

export const CODEX_ERROR =
  'ChatGPT connection failed. Try signing in again, or use API mode if your system cannot access its secure credential store.';
const MAX_LINE = 1_000_000;

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** Private stdio transport. Provider errors, stderr and account details never enter logs.
 * Server-initiated actions are rejected even if a future helper version offers a new tool. */
export class CodexClient extends EventEmitter {
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private readonly child: ChildProcessWithoutNullStreams;

  constructor(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    super();
    this.child = spawn(binary, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    // Consume and discard stderr: OAuth URLs, tokens and user input must not reach app logs.
    this.child.stderr.resume();
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => this.receive(line));
    this.child.on('error', () => this.fail());
    this.child.on('exit', () => this.fail());
    this.child.stdin.on('error', () => this.fail());
  }

  async initialize() {
    const result = await this.request('initialize', {
      clientInfo: { name: 'ezychat-lite', version: '1.0.0' },
      capabilities: { experimentalApi: false },
    });
    // The filesystem restrictions depend on the pinned helper's tool handlers. Fail closed
    // before any customer thread on an unsupported development override/helper upgrade.
    if (
      typeof result.userAgent !== 'string' ||
      !result.userAgent.startsWith(`ezychat-lite/${CODEX_PROTOCOL_VERSION} `)
    ) {
      this.close();
      throw new Error(`ChatGPT requires the bundled Codex ${CODEX_PROTOCOL_VERSION} helper.`);
    }
    this.write({ method: 'initialized', params: {} });
  }

  request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000,
  ): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error(CODEX_ERROR));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(CODEX_ERROR));
        this.close();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  private write(value: unknown) {
    try {
      if (!this.closed) this.child.stdin.write(`${JSON.stringify(value)}\n`);
    } catch {
      this.close();
    }
  }

  private receive(line: string) {
    if (this.closed) return;
    if (line.length > MAX_LINE) {
      this.close();
      return;
    }
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.close();
      return;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.close();
      return;
    }
    if (typeof value.method === 'string') {
      if (value.id !== undefined) {
        // All approvals, permissions, dynamic tools and prompts fail closed.
        if (value.method.endsWith('/requestApproval'))
          this.write({ id: value.id, result: { decision: 'decline' } });
        else
          this.write({
            id: value.id,
            error: { code: -32601, message: 'Tools are disabled for the AI member' },
          });
      } else if (
        value.params !== null &&
        typeof value.params === 'object' &&
        !Array.isArray(value.params)
      )
        this.emit('notification', value.method, value.params);
      return;
    }
    if (typeof value.id !== 'number') return;
    const pending = this.pending.get(value.id);
    if (!pending) return;
    this.pending.delete(value.id);
    clearTimeout(pending.timer);
    if (
      value.error ||
      (value.result !== undefined &&
        (value.result === null || typeof value.result !== 'object' || Array.isArray(value.result)))
    )
      pending.reject(new Error(CODEX_ERROR));
    else pending.resolve((value.result ?? {}) as Record<string, unknown>);
  }

  private fail() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(CODEX_ERROR));
    }
    this.pending.clear();
    this.emit('closed');
  }

  close() {
    if (this.closed) return;
    this.fail();
    this.child.kill();
  }
}
