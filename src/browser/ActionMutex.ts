export class ActionMutexTimeoutError extends Error {
  constructor(message = 'ActionMutex acquisition timed out') {
    super(message);
    this.name = 'ActionMutexTimeoutError';
  }
}

export class ActionMutex {
  private locked = false;
  private queue: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
  }> = [];

  /**
   * Creates an idempotent release function to prevent multiple releases.
   */
  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  /**
   * Acquires the mutex lock. Returns a release function that MUST be called when done.
   */
  public async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve, reject) => {
      this.queue.push({
        resolve: (release) => resolve(release),
        reject,
      });
    });
  }

  /**
   * Acquires the mutex lock with a timeout to prevent deadlocks.
   */
  public async acquireWithTimeout(timeoutMs: number): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve, reject) => {
      let item: { resolve: (release: () => void) => void; reject: (err: Error) => void };

      const timer = setTimeout(() => {
        const index = this.queue.indexOf(item);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new ActionMutexTimeoutError(`Failed to acquire ActionMutex within ${timeoutMs}ms`));
        }
      }, timeoutMs);

      item = {
        resolve: (release) => {
          clearTimeout(timer);
          resolve(release);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };

      this.queue.push(item);
    });
  }

  /**
   * Executes an async operation exclusively within the lock, automatically releasing upon return or throw.
   */
  public async runExclusive<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
    const release = timeoutMs !== undefined
      ? await this.acquireWithTimeout(timeoutMs)
      : await this.acquire();

    try {
      return await fn();
    } finally {
      release();
    }
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        next.resolve(this.createRelease());
      }
    } else {
      this.locked = false;
    }
  }

  public isLocked(): boolean {
    return this.locked;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }
}
