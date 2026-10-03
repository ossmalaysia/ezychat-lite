import { describe, expect, it, vi } from 'vitest';
import { createServiceOperation } from './service-operation.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('desktop service operation gate', () => {
  it('acquires the gate before confirmation and rejects overlap from another entry point', async () => {
    const setBusy = vi.fn();
    const showError = vi.fn();
    const run = createServiceOperation(setBusy, showError);
    const confirmation = deferred();
    const install = vi.fn(() => confirmation.promise);
    const trayReset = vi.fn();
    const pending = run('Confirming install…', 'Install failed', install);
    expect(setBusy).toHaveBeenCalledWith('Confirming install…');
    await run('Resetting password…', 'Reset failed', trayReset);
    expect(trayReset).not.toHaveBeenCalled();
    expect(setBusy).toHaveBeenCalledTimes(1);
    confirmation.resolve();
    await pending;
    expect(setBusy).toHaveBeenLastCalledWith(null);
    await run('Resetting password…', 'Reset failed', trayReset);
    expect(trayReset).toHaveBeenCalledOnce();
    expect(showError).not.toHaveBeenCalled();
  });

  it('clears busy when confirmation is cancelled without showing an error', async () => {
    const setBusy = vi.fn();
    const showError = vi.fn();
    const run = createServiceOperation(setBusy, showError);
    await run('Confirming removal…', 'Remove failed', async () => undefined);
    expect(setBusy.mock.calls).toEqual([['Confirming removal…'], [null]]);
    expect(showError).not.toHaveBeenCalled();
  });

  it('holds the gate through failure recovery and shows the original error once', async () => {
    const setBusy = vi.fn();
    const showError = vi.fn();
    const run = createServiceOperation(setBusy, showError);
    const recovery = deferred();
    const error = new Error('Install failed');
    const recover = vi.fn(() => recovery.promise);
    const pending = run(
      'Installing…',
      'Could not install service',
      async () => {
        throw error;
      },
      recover,
    );
    await Promise.resolve();
    expect(showError).toHaveBeenCalledWith('Could not install service', error);
    expect(recover).toHaveBeenCalledOnce();
    const other = vi.fn();
    await run('Stopping…', 'Stop failed', other);
    expect(other).not.toHaveBeenCalled();
    recovery.resolve();
    await pending;
    expect(setBusy).toHaveBeenLastCalledWith(null);
    expect(showError).toHaveBeenCalledOnce();
  });

  it('releases the gate even if recovery itself fails', async () => {
    const setBusy = vi.fn();
    const run = createServiceOperation(setBusy, vi.fn());
    await expect(
      run(
        'Installing…',
        'Install failed',
        async () => {
          throw new Error('Install');
        },
        async () => {
          throw new Error('Recovery');
        },
      ),
    ).rejects.toThrow('Recovery');
    expect(setBusy).toHaveBeenLastCalledWith(null);
    const next = vi.fn();
    await run('Starting…', 'Start failed', next);
    expect(next).toHaveBeenCalledOnce();
  });
});
