import { useSyncExternalStore } from "react";

/**
 * The current time, as something a component may render from.
 *
 * "Updated 4 minutes ago" needs to know what time it is, and a component may not read
 * the clock while rendering: `Date.now()` is not a function of its inputs, so the React
 * Compiler rejects it and would be right to. Reading it in an effect and storing it in
 * state is the other obvious move, and the lint rules reject that too — for the same
 * underlying reason, that it is a render driven by something outside React.
 *
 * So the clock is modelled as what it actually is: an external source that changes on
 * its own and that components subscribe to. One interval serves every subscriber and
 * stops when the last one goes, so an offline notice sitting on a screen costs one timer
 * for the app rather than one per notice.
 *
 * The tick is deliberately slow. The wording it feeds never changes faster than once a
 * minute (see `freshness.ts`), so anything quicker would be re-rendering to show the
 * same words.
 */

const TICK_MS = 30_000;

let current = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (timer === null) {
    // The stored time may be from whenever this module was first loaded, which could be
    // an hour ago on a long-running app. Refresh it as the first subscriber arrives.
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const notify of listeners) notify();
    }, TICK_MS);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Stable between ticks, which is what stops it re-rendering on every frame. */
function snapshot(): number {
  return current;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
