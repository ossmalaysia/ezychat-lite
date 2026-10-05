// Keeps checking for the background service from the error page (no electron import; unit tested).

export interface ServiceRecoveryOptions {
  /** true once the service answers /api/health */
  probe: () => Promise<boolean>;
  /** false once the window has left the error page: the watch stops */
  isActive: () => boolean;
  /** false while a user operation runs: skip this tick */
  canSwitch: () => boolean;
  /** called once, when the service answered and switching is still allowed */
  onAnswer: () => void;
  intervalMs?: number;
}

/**
 * Probes on an interval until the service answers or the error page is left. Probes never
 * overlap, and the answer is acted on only if switching is still allowed after it resolves.
 * Returns a function that stops the watch.
 */
export function watchForService(options: ServiceRecoveryOptions): () => void {
  let stopped = false;
  let probing = false;
  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };
  const timer = setInterval(() => {
    if (stopped) return;
    if (!options.isActive()) return stop();
    if (probing || !options.canSwitch()) return;
    probing = true;
    options
      .probe()
      .then((found) => {
        if (!found || stopped || !options.isActive() || !options.canSwitch()) return;
        stop();
        options.onAnswer();
      })
      .catch(() => {
        // try again on the next tick
      })
      .finally(() => {
        probing = false;
      });
  }, options.intervalMs ?? 5_000);
  return stop;
}
