import { useEffect, useState } from "react";

/**
 * A value that settles only once it has stopped changing.
 *
 * Used by Search so that typing a name is one request rather than one per keystroke.
 * Each change restarts the timer and cancels the previous one, so only the last value
 * in a burst is ever returned.
 *
 * Deliberately not a debounced *callback*: a settled value feeds a query key, and a
 * query key is what makes an out-of-date response impossible to render — a result for
 * an earlier value is stored under that earlier key and is never mistaken for the
 * answer to the current one.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (value === settled) return;

    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, settled, delayMs]);

  return settled;
}
