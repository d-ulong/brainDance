/**
 * Serializes async append operations so only one runs at a time and callers
 * observe strict completion order.
 */
export function createTrainingEventQueue<T>() {
  let chain: Promise<T | void> = Promise.resolve();

  return {
    enqueue(task: () => Promise<T>): Promise<T> {
      const run = chain.then(task, task);
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
