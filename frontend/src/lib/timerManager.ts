/**
 * Trợ giúp quản lý timer an toàn: luôn clear timer cũ trước khi tạo timer mới hoặc khi unmount.
 */
export interface TimerRefLike<T = ReturnType<typeof setInterval>> {
  current: T | null;
}

export type ClearTimerFn<T = ReturnType<typeof setInterval>> = (id: T) => void;
export type SetTimerFn<T = ReturnType<typeof setInterval>> = (
  callback: () => void,
  delayMs: number
) => T;

export function clearTimerRef<T>(
  ref: TimerRefLike<T>,
  clearFn: ClearTimerFn<T> = clearInterval as unknown as ClearTimerFn<T>
): void {
  if (ref.current !== null && ref.current !== undefined) {
    clearFn(ref.current);
    ref.current = null;
  }
}

export function replaceTimerRef<T>(
  ref: TimerRefLike<T>,
  callback: () => void,
  delayMs: number,
  setFn: SetTimerFn<T> = setInterval as unknown as SetTimerFn<T>,
  clearFn: ClearTimerFn<T> = clearInterval as unknown as ClearTimerFn<T>
): T {
  clearTimerRef(ref, clearFn);
  const id = setFn(callback, delayMs);
  ref.current = id;
  return id;
}

export function clearAllTimerRefs<T>(
  refs: TimerRefLike<T>[],
  clearFn: ClearTimerFn<T> = clearInterval as unknown as ClearTimerFn<T>
): void {
  for (const ref of refs) {
    clearTimerRef(ref, clearFn);
  }
}
