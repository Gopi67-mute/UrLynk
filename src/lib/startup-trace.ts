/**
 * Startup timing marks: what the app actually spends its first second on.
 *
 * Measuring beats guessing, and this is the instrument. Each interesting moment —
 * the bundle evaluating, fonts arriving, Clerk settling, the cache restoring, Home
 * painting its first number — records one mark, and the marks are logged in a form
 * `adb logcat` can be grepped for:
 *
 *     [urlynk-trace] 412ms (+118ms) auth:loaded
 *
 * Three rules make the numbers trustworthy:
 *
 * - **First wins.** A mark is recorded once. React renders a component many times and
 *   effects re-run; "when Home first had its counts" must not drift later every time
 *   it re-renders.
 * - **One clock.** Every elapsed figure is measured from `createTrace` being called,
 *   which happens as the root layout module is evaluated — the earliest point in the
 *   JS bundle this app controls. It is not process start: the native launch, the
 *   runtime boot and the bundle download all happen before it, which is why the
 *   on-device figures in the report are wall-clock stopwatch readings and these are
 *   the breakdown *within* the JS.
 * - **Nothing personal.** A mark is a fixed name from the call site, never a value.
 *   Request marks carry a path with its query string removed, for the same reason the
 *   backend logs paths only: a search term is the member a leader was looking for.
 *
 * The clock and the sink are both injected, so the whole thing runs under `node --test`
 * with no React Native and no real timer.
 */

export type TraceMark = {
  readonly name: string;
  /** Milliseconds from the trace's start. */
  readonly at: number;
  /** Milliseconds from the previous mark. */
  readonly sincePrevious: number;
};

export type Trace = {
  /**
   * Record a moment, if it has not been recorded already.
   *
   * Returns the mark — the existing one when the name has been seen before, so a
   * caller can read the first occurrence rather than the current time.
   */
  mark(name: string): TraceMark;
  /**
   * Log something that happens repeatedly, such as a request finishing.
   *
   * Unlike `mark`, every call is written and nothing is kept: counting cold-start
   * requests means seeing all of them, including the duplicates that are the point of
   * the exercise.
   */
  event(name: string): void;
  /** Every mark so far, in the order they happened. */
  marks(): readonly TraceMark[];
  /** Start again from zero. Used by the tests, and by a trace restarted on resume. */
  reset(): void;
  readonly enabled: boolean;
};

export type TraceOptions = {
  /** Monotonic milliseconds. Defaults to `Date.now`, which every runtime has. */
  now?: () => number;
  /** Where a mark is written. Defaults to `console.log`. */
  log?: (line: string) => void;
  /** When false, marks are still recorded but nothing is logged. */
  enabled?: boolean;
};

/** `[urlynk-trace] 412ms (+118ms) auth:loaded` */
export function formatMark(mark: TraceMark): string {
  return `[urlynk-trace] ${Math.round(mark.at)}ms (+${Math.round(mark.sincePrevious)}ms) ${mark.name}`;
}

export function createTrace(options: TraceOptions = {}): Trace {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));
  const enabled = options.enabled ?? true;

  let startedAt = now();
  let previousAt = startedAt;
  const recorded = new Map<string, TraceMark>();

  return {
    enabled,
    mark(name: string): TraceMark {
      const existing = recorded.get(name);
      if (existing) return existing;

      const at = now();
      const mark: TraceMark = {
        name,
        at: at - startedAt,
        sincePrevious: at - previousAt,
      };
      previousAt = at;
      recorded.set(name, mark);
      if (enabled) log(formatMark(mark));
      return mark;
    },
    event(name: string): void {
      if (!enabled) return;
      log(`[urlynk-trace] ${Math.round(now() - startedAt)}ms ${name}`);
    },
    marks(): readonly TraceMark[] {
      return [...recorded.values()].sort((a, b) => a.at - b.at);
    },
    reset(): void {
      startedAt = now();
      previousAt = startedAt;
      recorded.clear();
    },
  };
}

/**
 * Strip a query string from a request path.
 *
 * `/api/v1/members/search?q=ajay` is a record of who a leader was looking for, so only
 * `/api/v1/members/search` is ever logged — the same rule the backend's request log
 * follows.
 */
export function tracePath(path: string): string {
  const queryAt = path.indexOf("?");
  return queryAt === -1 ? path : path.slice(0, queryAt);
}

// Declared here rather than taken from React Native's global types: this module is also
// compiled by the test project, which types Node's globals instead of the app's.
declare const __DEV__: boolean | undefined;

/**
 * True in a development build, false anywhere `__DEV__` is not defined (a release
 * bundle, and the Node test runner).
 */
function isDevelopmentBuild(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__ === true;
}

/**
 * The app's own trace, started as this module is first imported.
 *
 * Silent outside development: a release build records marks but logs nothing, so the
 * instrument costs a map insertion and never writes to the device log.
 */
export const startupTrace: Trace = createTrace({ enabled: isDevelopmentBuild() });
