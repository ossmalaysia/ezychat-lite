import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceModelStatus } from '@wa-team-inbox/shared';
import {
  VOICE_MODEL_FILES,
  VoiceModelManager,
  voiceModelUrl,
  voiceModelUrlAllowed,
  type VoiceModelFile,
} from './model.js';

const CONTENT: Record<string, Buffer> = {
  'small-encoder.int8.onnx': Buffer.from('encoder-weights'),
  'small-decoder.int8.onnx': Buffer.from('decoder-weights-longer'),
  'small-tokens.txt': Buffer.from('tokens'),
};
const FILES: VoiceModelFile[] = Object.entries(CONTENT).map(([name, bytes]) => ({
  name,
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}));
const CDN = 'https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/';

let dir: string;
let states: VoiceModelStatus[];
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'wati-voice-')), 'whisper-small');
  states = [];
});
afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true });
});

/** GitHub answers with a redirect to its asset CDN, which serves `body(name)`. */
function github(body: (name: string) => Buffer | ReadableStream<Uint8Array> = (n) => CONTENT[n]!) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://github.com/')) {
      const name = url.split('/').at(-1)!;
      return new Response(null, { status: 302, headers: { location: `${CDN}${name}?sig=x` } });
    }
    const name = new URL(url).pathname.split('/').at(-1)!;
    const content = body(name);
    return new Response(content instanceof Buffer ? new Uint8Array(content) : content, {
      status: 200,
    });
  });
}

function manager(fetch: typeof globalThis.fetch, free = 10 * 1024 ** 3) {
  return new VoiceModelManager({
    dir,
    files: FILES,
    fetch,
    freeBytes: async () => free,
    onChange: (status) => states.push(status),
    progressIntervalMs: 0,
  });
}

const leftovers = () =>
  existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.partial')) : [];

describe('voice model manager', () => {
  it('pins the published release files', () => {
    expect(VOICE_MODEL_FILES.map((file) => [file.name, file.size])).toEqual([
      ['small-encoder.int8.onnx', 112_442_483],
      ['small-decoder.int8.onnx', 262_226_114],
      ['small-tokens.txt', 816_730],
    ]);
    expect(voiceModelUrl('small-tokens.txt')).toBe(
      'https://github.com/ossmalaysia/ezychat-lite/releases/download/models-whisper-small-v1/small-tokens.txt',
    );
  });

  it('allows only the pinned GitHub URL and the GitHub asset CDN', () => {
    const name = 'small-tokens.txt';
    expect(voiceModelUrlAllowed(voiceModelUrl(name), name)).toBe(true);
    expect(voiceModelUrlAllowed(`${CDN}x?sig=1`, name)).toBe(true);
    expect(
      voiceModelUrlAllowed(
        'https://release-assets.githubusercontent.com/github-production-release-asset/9/x',
        name,
      ),
    ).toBe(true);
    for (const bad of [
      voiceModelUrl('other.onnx'),
      voiceModelUrl(name).replace('https:', 'http:'),
      `${voiceModelUrl(name)}?x=1`,
      'https://github.com/evil/repo/releases/download/models-whisper-small-v1/small-tokens.txt',
      'https://objects.githubusercontent.com/other/x',
      'https://objects.githubusercontent.com:444/github-production-release-asset/x',
      'https://evil.example/github-production-release-asset/x',
      'https://user@objects.githubusercontent.com/github-production-release-asset/x',
    ])
      expect(voiceModelUrlAllowed(bad, name), bad).toBe(false);
  });

  it('downloads, verifies and installs every file, reporting progress', async () => {
    const fetch = github();
    const m = manager(fetch);
    expect(m.init().state).toBe('not_installed');
    states.length = 0;
    expect(m.start().state).toBe('downloading');
    await m.whenIdle();
    expect(m.status()).toMatchObject({ state: 'installed', error: null });
    expect(m.paths()).toEqual({
      encoder: join(dir, 'small-encoder.int8.onnx'),
      decoder: join(dir, 'small-decoder.int8.onnx'),
      tokens: join(dir, 'small-tokens.txt'),
    });
    expect(states[0]!.state).toBe('downloading');
    expect(states.at(-1)!.state).toBe('installed');
    const total = FILES.reduce((n, f) => n + f.size, 0);
    expect(states.some((s) => s.state === 'downloading' && s.receivedBytes === total)).toBe(true);
    // The redirect is followed manually, never automatically.
    for (const [, init] of fetch.mock.calls) expect(init).toMatchObject({ redirect: 'manual' });
    expect(leftovers()).toEqual([]);
  });

  it('rejects a file with the wrong hash and cleans up its partial', async () => {
    const m = manager(
      github((name) =>
        name === 'small-decoder.int8.onnx' ? Buffer.from('decoder-weights-LONGER') : CONTENT[name]!,
      ),
    );
    m.init();
    m.start();
    await m.whenIdle();
    expect(m.status()).toMatchObject({ state: 'error', error: 'verification' });
    expect(existsSync(join(dir, 'small-decoder.int8.onnx'))).toBe(false);
    expect(m.paths()).toBeNull();
    expect(leftovers()).toEqual([]);
  });

  it('rejects a file with the wrong size', async () => {
    const m = manager(github((name) => Buffer.concat([CONTENT[name]!, Buffer.from('!')])));
    m.start();
    await m.whenIdle();
    expect(m.status()).toMatchObject({ state: 'error', error: 'verification' });
    expect(leftovers()).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses a redirect to a host outside the allowlist', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://evil.example/model' } }),
    );
    const m = manager(fetch);
    m.start();
    await m.whenIdle();
    expect(m.status()).toMatchObject({ state: 'error', error: 'redirect' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses to start without enough free disk space', async () => {
    const fetch = github();
    const m = manager(fetch, 100 * 1024 * 1024);
    m.start();
    await m.whenIdle();
    expect(m.status()).toMatchObject({ state: 'error', error: 'disk_space' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('runs a single download at a time', async () => {
    const fetch = github();
    const m = manager(fetch);
    m.start();
    m.start();
    await m.whenIdle();
    expect(fetch).toHaveBeenCalledTimes(FILES.length * 2); // redirect + CDN per file
    m.start(); // installed: nothing to do
    expect(fetch).toHaveBeenCalledTimes(FILES.length * 2);
  });

  it('cancels a running download and removes its partial file', async () => {
    let started!: () => void;
    const begun = new Promise<void>((resolve) => (started = resolve));
    const m = manager(
      github(
        () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              started();
            },
            // never closes
          }),
      ),
    );
    m.start();
    await begun;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await m.cancel()).state).toBe('not_installed');
    expect(leftovers()).toEqual([]);
  });

  it('removes an installed model and reports a stale install as not installed at startup', async () => {
    const m = manager(github());
    m.start();
    await m.whenIdle();
    expect((await m.remove()).state).toBe('not_installed');
    expect(existsSync(dir)).toBe(false);

    mkdirSync(dir, { recursive: true });
    for (const [name, bytes] of Object.entries(CONTENT)) writeFileSync(join(dir, name), bytes);
    writeFileSync(join(dir, 'small-tokens.txt.partial'), 'x');
    const fresh = manager(github());
    expect(fresh.init().state).toBe('installed');
    expect(leftovers()).toEqual([]);
    writeFileSync(join(dir, 'small-tokens.txt'), 'short');
    expect(fresh.init().state).toBe('not_installed');
  });

  it('keeps already verified files when a download resumes', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'small-encoder.int8.onnx'), CONTENT['small-encoder.int8.onnx']!);
    const fetch = github();
    const m = manager(fetch);
    m.start();
    await m.whenIdle();
    expect(m.status().state).toBe('installed');
    expect(fetch.mock.calls.map(([url]) => String(url)).join(' ')).not.toContain('encoder');
  });
});
