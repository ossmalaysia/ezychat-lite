import type { ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLines, stopChild } from './process.js';

afterEach(() => vi.useRealTimers());

describe('readLines', () => {
  it('handles split UTF-8, CRLF, empty lines and the final unterminated line', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    readLines(stream, (line) => lines.push(line));
    const bytes = Buffer.from('first\r\n\nemoji 😀\nlast');
    for (const byte of bytes) stream.write(Buffer.from([byte]));
    const ended = once(stream, 'end');
    stream.end();
    await ended;
    expect(lines).toEqual(['first', 'emoji 😀', 'last']);
  });

  it('bounds an unterminated log line while retaining its useful tail', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    readLines(stream, (line) => lines.push(line));
    stream.write('x'.repeat(100_000));
    stream.write(' useful tail');
    const ended = once(stream, 'end');
    stream.end();
    await ended;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.length).toBe(65_536);
    expect(lines[0]).toMatch(/ useful tail$/);
  });
});

describe('stopChild', () => {
  function child() {
    const emitter = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(() => true),
    });
    return { emitter, process: emitter as unknown as ChildProcess };
  }
  it.each(['close', 'error'] as const)('cleans up listeners and timers after %s', async (event) => {
    vi.useFakeTimers();
    const { emitter, process } = child();
    const pending = stopChild(process);
    expect(emitter.kill).toHaveBeenCalledOnce();
    emitter.emit(event);
    await pending;
    expect(emitter.listenerCount('close')).toBe(0);
    expect(emitter.listenerCount('error')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans up on timeout when a child never closes', async () => {
    vi.useFakeTimers();
    const { emitter, process } = child();
    const pending = stopChild(process, 10);
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(emitter.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['false', 'throw'] as const)('does not wait if kill returns %s', async (result) => {
    vi.useFakeTimers();
    const { emitter, process } = child();
    emitter.kill.mockImplementation(() => {
      if (result === 'throw') throw new Error('already gone');
      return false;
    });
    await stopChild(process);
    expect(emitter.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not kill an already exited process', async () => {
    const { emitter, process } = child();
    emitter.exitCode = 0;
    await stopChild(process);
    expect(emitter.kill).not.toHaveBeenCalled();
  });
});
