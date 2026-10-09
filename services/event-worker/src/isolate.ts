export type Rejected<T> = { item: T; error: unknown };

/**
 * Write a batch, isolating rows the sink refuses.
 *
 * If the whole batch is accepted this is a single call. If the sink fails with
 * a data error, the batch is split in half and each half retried, so a single
 * bad row costs O(log n) extra calls and ends up in the returned list instead
 * of failing everything around it. Any other error (the sink being down) is
 * rethrown untouched so the caller retries the batch later.
 */
export async function writeIsolating<T>(
  items: T[],
  write: (batch: T[]) => Promise<void>,
  isDataError: (err: unknown) => boolean
): Promise<Rejected<T>[]> {
  if (items.length === 0) return [];
  try {
    await write(items);
    return [];
  } catch (error) {
    if (!isDataError(error)) throw error;
    if (items.length === 1) return [{ item: items[0] as T, error }];
    const mid = Math.floor(items.length / 2);
    const left = await writeIsolating(items.slice(0, mid), write, isDataError);
    const right = await writeIsolating(items.slice(mid), write, isDataError);
    return [...left, ...right];
  }
}
