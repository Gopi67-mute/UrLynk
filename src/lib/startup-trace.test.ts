import assert from "node:assert/strict";
import { test } from "node:test";
import { createTrace, formatMark, tracePath } from "./startup-trace.ts";

/** A clock the test drives by hand, so no measurement depends on real time. */
function fakeClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

test("a mark records its distance from the start and from the previous mark", () => {
  const clock = fakeClock();
  const trace = createTrace({ now: clock.now, enabled: false });

  clock.advance(120);
  const first = trace.mark("fonts:ready");
  clock.advance(300);
  const second = trace.mark("auth:loaded");

  assert.equal(first.at, 120);
  assert.equal(first.sincePrevious, 120);
  assert.equal(second.at, 420);
  assert.equal(second.sincePrevious, 300);
});

// React renders a component many times and effects re-run. "When Home first had its
// counts" has to stay the first time, or every later render would quietly move it.
test("marking the same moment twice keeps the first time", () => {
  const clock = fakeClock();
  const trace = createTrace({ now: clock.now, enabled: false });

  clock.advance(50);
  const first = trace.mark("home:counts");
  clock.advance(5_000);
  const again = trace.mark("home:counts");

  assert.equal(again.at, 50);
  assert.deepEqual(again, first);
  assert.equal(trace.marks().length, 1);
});

test("marks come back in the order they happened", () => {
  const clock = fakeClock();
  const trace = createTrace({ now: clock.now, enabled: false });

  trace.mark("js:start");
  clock.advance(10);
  trace.mark("shell:render");
  clock.advance(10);
  trace.mark("home:counts");

  assert.deepEqual(
    trace.marks().map((mark) => mark.name),
    ["js:start", "shell:render", "home:counts"],
  );
});

test("a disabled trace still records, it just writes nothing", () => {
  const lines: string[] = [];
  const trace = createTrace({ log: (line) => lines.push(line), enabled: false });

  trace.mark("auth:loaded");

  assert.equal(lines.length, 0);
  assert.equal(trace.marks().length, 1);
});

test("an enabled trace writes one greppable line per mark", () => {
  const clock = fakeClock();
  const lines: string[] = [];
  const trace = createTrace({ now: clock.now, log: (line) => lines.push(line) });

  clock.advance(412);
  trace.mark("auth:loaded");

  assert.deepEqual(lines, ["[urlynk-trace] 412ms (+412ms) auth:loaded"]);
});

// The duplicates are the finding, so an event must never be collapsed the way a mark is.
test("every event is written, including repeats of the same name", () => {
  const clock = fakeClock();
  const lines: string[] = [];
  const trace = createTrace({ now: clock.now, log: (line) => lines.push(line) });

  clock.advance(100);
  trace.event("api GET /api/v1/members/recent 42ms");
  clock.advance(60);
  trace.event("api GET /api/v1/members/recent 38ms");

  assert.deepEqual(lines, [
    "[urlynk-trace] 100ms api GET /api/v1/members/recent 42ms",
    "[urlynk-trace] 160ms api GET /api/v1/members/recent 38ms",
  ]);
  assert.equal(trace.marks().length, 0);
});

test("a disabled trace writes no events either", () => {
  const lines: string[] = [];
  const trace = createTrace({ log: (line) => lines.push(line), enabled: false });

  trace.event("api GET /api/v1/teams/me 12ms");

  assert.equal(lines.length, 0);
});

test("resetting starts the clock again", () => {
  const clock = fakeClock();
  const trace = createTrace({ now: clock.now, enabled: false });

  clock.advance(900);
  trace.mark("home:counts");
  trace.reset();
  clock.advance(40);
  const afterReset = trace.mark("home:counts");

  assert.equal(afterReset.at, 40);
});

test("fractional milliseconds are rounded for display, not for measurement", () => {
  assert.equal(
    formatMark({ name: "api:ok", at: 412.6, sincePrevious: 118.4 }),
    "[urlynk-trace] 413ms (+118ms) api:ok",
  );
});

// The same rule the backend's request log follows: a query string can carry the name of
// the member a leader was searching for, and a log line must not describe a person.
test("a traced path never carries the query string", () => {
  assert.equal(tracePath("/api/v1/members/search?q=ajay"), "/api/v1/members/search");
  assert.equal(tracePath("/api/v1/members?limit=50&cursor=abc"), "/api/v1/members");
  assert.equal(tracePath("/api/v1/teams/me"), "/api/v1/teams/me");
});
