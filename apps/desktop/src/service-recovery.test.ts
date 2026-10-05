import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchForService } from './service-recovery.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function harness(answers: boolean[]) {
  const state = { active: true, canSwitch: true, probes: 0, answered: 0 };
  const stop = watchForService({
    probe: async () => answers[state.probes++] ?? false,
    isActive: () => state.active,
    canSwitch: () => state.canSwitch,
    onAnswer: () => state.answered++,
    intervalMs: 5_000,
  });
  return { state, stop };
}

describe('watchForService', () => {
  it('opens the inbox once the late service answers, then stops probing', async () => {
    const { state } = harness([false, false, true]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.answered).toBe(1);
    expect(state.probes).toBe(3);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.probes).toBe(3);
    expect(state.answered).toBe(1);
  });

  it('does not probe while a user operation runs', async () => {
    const { state } = harness([true]);
    state.canSwitch = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.probes).toBe(0);
    state.canSwitch = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.answered).toBe(1);
  });

  it('stops for good once the error page is left', async () => {
    const { state } = harness([true]);
    state.active = false;
    await vi.advanceTimersByTimeAsync(5_000);
    state.active = true;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.probes).toBe(0);
    expect(state.answered).toBe(0);
  });

  it('never runs two probes at once', async () => {
    let release = (_found: boolean) => {};
    let calls = 0;
    let answered = 0;
    watchForService({
      probe: () => {
        calls++;
        return new Promise<boolean>((r) => (release = r));
      },
      isActive: () => true,
      canSwitch: () => true,
      onAnswer: () => answered++,
      intervalMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toBe(1);
    release(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toBe(1);
  });

  it('ignores an answer that arrives after an operation started', async () => {
    let release = (_found: boolean) => {};
    let canSwitch = true;
    let answered = 0;
    watchForService({
      probe: () => new Promise<boolean>((r) => (release = r)),
      isActive: () => true,
      canSwitch: () => canSwitch,
      onAnswer: () => answered++,
      intervalMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    canSwitch = false;
    release(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toBe(0);
  });

  it('can be stopped by the caller', async () => {
    const { state, stop } = harness([true]);
    stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.probes).toBe(0);
  });
});
