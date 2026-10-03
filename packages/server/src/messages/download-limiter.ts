export interface DownloadLimiterOptions {
  /** max downloads running at once */
  concurrency: number;
  /** a task not settled within this many ms is rejected (its slot is freed) */
  timeoutMs: number;
}

/** Tiny in-process FIFO queue: bounds concurrent media downloads and times out stuck ones. */
export class DownloadLimiter {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly opts: DownloadLimiterOptions) {}

  get active(): number {
    return this.running;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.opts.concurrency) {
      // the slot is handed over directly by the finishing task (running is not decremented)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running++;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const work = Promise.resolve().then(task);
      work.catch(() => undefined); // a late failure after a timeout must not become unhandled
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`media download timed out after ${this.opts.timeoutMs}ms`)), this.opts.timeoutMs);
      });
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}
