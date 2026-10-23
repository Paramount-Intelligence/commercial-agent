export type SpeechPipelineStats = {
  enqueued: number;
  prepared: number;
  played: number;
  maxAheadObserved: number;
};

type PipelineItem<Input, Prepared> = {
  input: Input;
  prepared?: Promise<Prepared>;
};

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/**
 * Prepare checked speech chunks ahead of playback while keeping playback
 * strictly ordered. `maxAhead=2` means the current chunk plus one prefetched
 * chunk, preventing an LLM burst from launching unbounded TTS requests.
 */
export class OrderedSpeechPipeline<Input, Prepared> {
  private readonly items: Array<PipelineItem<Input, Prepared>> = [];
  private readonly maxAhead: number;
  private nextPrepare = 0;
  private nextPlay = 0;
  private closed = false;
  private running = false;
  private failure: unknown;
  private changeResolve: (() => void) | null = null;
  private completionResolve!: () => void;
  private readonly completion = new Promise<void>((resolve) => {
    this.completionResolve = resolve;
  });
  private readonly statsValue: SpeechPipelineStats = {
    enqueued: 0,
    prepared: 0,
    played: 0,
    maxAheadObserved: 0,
  };

  constructor(
    private readonly prepare: (
      input: Input,
      index: number,
    ) => Promise<Prepared>,
    private readonly play: (
      prepared: Prepared,
      input: Input,
      index: number,
    ) => Promise<void>,
    opts: { maxAhead?: number; signal?: AbortSignal } = {},
  ) {
    this.maxAhead = Math.max(1, Math.floor(opts.maxAhead ?? 2));
    this.signal = opts.signal;
    this.signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  private readonly signal?: AbortSignal;
  private readonly onAbort = () => this.notifyChange();

  enqueue(input: Input): void {
    if (this.closed) throw new Error('Speech pipeline is closed');
    if (this.signal?.aborted) throw abortError();
    this.items.push({ input });
    this.statsValue.enqueued += 1;
    this.startPreparations();
    this.ensureRunning();
    this.notifyChange();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ensureRunning();
    this.notifyChange();
    await this.completion;
    this.signal?.removeEventListener('abort', this.onAbort);
    if (this.failure) throw this.failure;
  }

  stats(): SpeechPipelineStats {
    return { ...this.statsValue };
  }

  private startPreparations() {
    while (
      this.nextPrepare < this.items.length &&
      this.nextPrepare - this.nextPlay < this.maxAhead
    ) {
      const index = this.nextPrepare;
      const item = this.items[index]!;
      this.nextPrepare += 1;
      this.statsValue.maxAheadObserved = Math.max(
        this.statsValue.maxAheadObserved,
        this.nextPrepare - this.nextPlay,
      );
      item.prepared = this.prepare(item.input, index).then((result) => {
        this.statsValue.prepared += 1;
        return result;
      });
      // A later prefetched item may fail while the current sentence is still
      // playing. Observe it now; ordered playback will surface the same error
      // when that item reaches the front of the queue.
      void item.prepared.catch(() => {});
    }
  }

  private ensureRunning() {
    if (this.running) return;
    this.running = true;
    void this.run();
  }

  private async run() {
    try {
      for (;;) {
        if (this.signal?.aborted) throw abortError();
        this.startPreparations();
        const item = this.items[this.nextPlay];
        if (!item) {
          if (this.closed) return;
          await this.waitForChange();
          continue;
        }
        if (!item.prepared) {
          await this.waitForChange();
          continue;
        }
        const prepared = await this.abortable(item.prepared);
        await this.abortable(
          this.play(prepared, item.input, this.nextPlay),
        );
        this.nextPlay += 1;
        this.statsValue.played += 1;
        this.startPreparations();
      }
    } catch (error) {
      this.failure = error;
    } finally {
      this.running = false;
      this.completionResolve();
    }
  }

  private abortable<T>(work: Promise<T>): Promise<T> {
    if (!this.signal) return work;
    if (this.signal.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(abortError());
      this.signal!.addEventListener('abort', abort, { once: true });
      work.then(
        (value) => {
          this.signal!.removeEventListener('abort', abort);
          resolve(value);
        },
        (error) => {
          this.signal!.removeEventListener('abort', abort);
          reject(error);
        },
      );
    });
  }

  private waitForChange(): Promise<void> {
    return new Promise((resolve) => {
      this.changeResolve = resolve;
    });
  }

  private notifyChange() {
    const resolve = this.changeResolve;
    this.changeResolve = null;
    resolve?.();
  }
}
