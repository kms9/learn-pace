export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
}
