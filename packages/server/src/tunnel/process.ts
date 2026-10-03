import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

/** Both tunnel modes consume bounded lines, including a final line without a newline. */
export function readLines(stream: Readable | null, onLine: (line: string) => void): void {
  if (!stream) return;
  const maxLength = 65_536;
  let buffer = '';
  const emit = (line: string) => {
    const value = line.slice(-maxLength).trimEnd();
    if (value) onLine(value);
  };
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string | Buffer) => {
    buffer += chunk.toString();
    let end: number;
    while ((end = buffer.indexOf('\n')) !== -1) {
      emit(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
    }
    buffer = buffer.slice(-maxLength);
  });
  stream.on('end', () => emit(buffer));
  stream.on('error', () => undefined);
}

/** Wait for process and pipe closure, cleaning up our timer/listeners on every exit path. */
export async function stopChild(child: ChildProcess, timeoutMs = 5000): Promise<void> {
  if (child.exitCode !== null || child.signalCode != null) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      child.off('close', finish);
      child.off('error', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref();
    child.once('close', finish);
    child.once('error', finish);
    try {
      if (!child.kill()) finish();
    } catch {
      finish();
    }
  });
}
