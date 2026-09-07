import { describe, it, expect } from 'vitest';
import { ActionMutex, ActionMutexTimeoutError } from '../../src/browser/ActionMutex.js';

describe('ActionMutex Subsystem', () => {
  it('should allow sequential acquisition and release', async () => {
    const mutex = new ActionMutex();
    expect(mutex.isLocked()).toBe(false);

    const release1 = await mutex.acquire();
    expect(mutex.isLocked()).toBe(true);
    release1();
    expect(mutex.isLocked()).toBe(false);

    const release2 = await mutex.acquire();
    expect(mutex.isLocked()).toBe(true);
    release2();
    expect(mutex.isLocked()).toBe(false);
  });

  it('should enforce strictly serial execution (FIFO order)', async () => {
    const mutex = new ActionMutex();
    const executionOrder: number[] = [];

    const task = async (id: number, delayMs: number) => {
      const release = await mutex.acquire();
      try {
        executionOrder.push(id);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } finally {
        release();
      }
    };

    // Launch tasks concurrently
    await Promise.all([
      task(1, 30),
      task(2, 20),
      task(3, 10),
    ]);

    expect(executionOrder).toEqual([1, 2, 3]);
  });

  it('should release lock cleanly via runExclusive even if action throws', async () => {
    const mutex = new ActionMutex();

    await expect(
      mutex.runExclusive(async () => {
        throw new Error('Action failed inside lock');
      })
    ).rejects.toThrow('Action failed inside lock');

    expect(mutex.isLocked()).toBe(false);

    // Subsequent acquisition should succeed immediately
    let ranSecond = false;
    await mutex.runExclusive(async () => {
      ranSecond = true;
    });
    expect(ranSecond).toBe(true);
  });

  it('should timeout when lock cannot be acquired within timeoutMs', async () => {
    const mutex = new ActionMutex();
    const release = await mutex.acquire();

    await expect(
      mutex.acquireWithTimeout(50)
    ).rejects.toThrow(ActionMutexTimeoutError);

    release();
    expect(mutex.isLocked()).toBe(false);
  });

  it('should treat multiple release calls as idempotent and prevent premature dequeue', async () => {
    const mutex = new ActionMutex();
    const release1 = await mutex.acquire();
    expect(mutex.isLocked()).toBe(true);

    let task2Started = false;
    const task2Promise = mutex.acquire().then((rel2) => {
      task2Started = true;
      return rel2;
    });

    // Calling release1 multiple times should not cause extra dequeue
    release1();
    release1();
    release1();

    const release2 = await task2Promise;
    expect(task2Started).toBe(true);
    expect(mutex.isLocked()).toBe(true);

    release2();
    expect(mutex.isLocked()).toBe(false);
  });
});
