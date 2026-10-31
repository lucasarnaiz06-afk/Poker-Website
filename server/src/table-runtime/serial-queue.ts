/**
 * Runs tasks strictly one after another (FIFO). A task that awaits keeps the queue blocked, so table
 * commands never interleave across awaits. A failing task rejects only its own promise.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  run<T>(task: () => T | Promise<T>): Promise<T> {
    this.pending += 1;
    const result = this.tail.then(task);
    this.tail = result
      .catch(() => undefined)
      .finally(() => {
        this.pending -= 1;
      });
    return result;
  }

  get size() {
    return this.pending;
  }

  /** Resolves once every task queued so far (and anything they queued) has finished. */
  async idle(): Promise<void> {
    while (this.pending > 0) {
      await this.tail;
    }
  }
}
