import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerResumeReconnect } from './resume-reconnect';

function makeSocket() {
  const listeners = new Map<string, () => void>();
  const socket = {
    listeners,
    connected: false,
    active: true,
    io: { engine: { readyState: 'closed' } },
    disconnect: vi.fn(),
    connect: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
    }),
    off: vi.fn((event: string) => {
      listeners.delete(event);
    }),
  };
  socket.disconnect.mockImplementation(() => {
    socket.active = false;
    return socket;
  });
  socket.connect.mockImplementation(() => {
    socket.active = true;
    socket.io.engine.readyState = 'opening';
    return socket;
  });
  return socket;
}

const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});

describe('foreground reconnect', () => {
  it.each([
    [document, 'visibilitychange'],
    [window, 'pageshow'],
    [window, 'online'],
    [document, 'resume'],
  ])('starts a new attempt on %s %s while an automatic retry is waiting', (target, event) => {
    const socket = makeSocket();
    cleanups.push(registerResumeReconnect(socket));

    target.dispatchEvent(new Event(event));

    expect(socket.disconnect).toHaveBeenCalledOnce();
    expect(socket.connect).toHaveBeenCalledOnce();
    expect(socket.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      socket.connect.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ['connected', true, true, 'open'],
    ['opening transport', false, true, 'opening'],
    ['namespace handshake', false, true, 'open'],
    ['revoked session', false, false, 'closed'],
  ])('leaves a %s connection alone', (_name, connected, active, readyState) => {
    const socket = makeSocket();
    Object.assign(socket, { connected, active });
    socket.io.engine.readyState = readyState;
    cleanups.push(registerResumeReconnect(socket));

    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'offline'])('does not start work while %s', (state) => {
    if (state === 'hidden') vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    else vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const socket = makeSocket();
    cleanups.push(registerResumeReconnect(socket));

    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('coalesces the foreground and online events into one in-flight attempt', () => {
    const socket = makeSocket();
    cleanups.push(registerResumeReconnect(socket));

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('online'));

    expect(socket.connect).toHaveBeenCalledOnce();
  });

  it('removes the listeners when the session ends', () => {
    const socket = makeSocket();
    const cleanup = registerResumeReconnect(socket);
    cleanup();

    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('resume'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('online'));

    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('reconnects when the suspended transport reports its drop after the foreground event', async () => {
    const socket = makeSocket();
    socket.connected = true;
    socket.io.engine.readyState = 'open';
    cleanups.push(registerResumeReconnect(socket));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(socket.connect).not.toHaveBeenCalled();

    socket.connected = false;
    socket.io.engine.readyState = 'closed';
    socket.listeners.get('disconnect')?.();
    await Promise.resolve();

    expect(socket.connect).toHaveBeenCalledOnce();
  });

  it('does not revive a session that ends before a queued resume attempt runs', async () => {
    const socket = makeSocket();
    socket.connected = true;
    socket.io.engine.readyState = 'open';
    const cleanup = registerResumeReconnect(socket);
    document.dispatchEvent(new Event('visibilitychange'));
    socket.connected = false;
    socket.io.engine.readyState = 'closed';
    socket.listeners.get('disconnect')?.();
    cleanup();
    await Promise.resolve();

    expect(socket.connect).not.toHaveBeenCalled();
  });
});
