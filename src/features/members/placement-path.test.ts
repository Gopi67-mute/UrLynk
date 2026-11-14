import assert from "node:assert/strict";
import { test } from "node:test";
import { depthText, pathRows, pathSummary, type PathStep } from "./placement-path.ts";

function step(
  name: string,
  placement_position: "LEFT" | "RIGHT" | null,
  overrides: Partial<PathStep> = {},
): PathStep {
  return {
    id: `member-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    mi_lifestyle_id: "0012345678",
    placement_position,
    is_root: placement_position === null,
    ...overrides,
  };
}

// Gopinath (ROOT) -> LEFT -> Ajay -> RIGHT -> Anil -> LEFT -> Vijay
const MIXED: PathStep[] = [
  step("Gopinath J UWTC", null),
  step("Ajay", "LEFT"),
  step("Anil", "RIGHT"),
  step("Vijay", "LEFT"),
];

test("the path is read from the root downwards, in the order it was sent", () => {
  const rows = pathRows(MIXED);

  assert.deepEqual(
    rows.map((row) => row.name),
    ["Gopinath J UWTC", "Ajay", "Anil", "Vijay"],
  );
});

test("each row is badged with the side that member occupies under the one above", () => {
  const rows = pathRows(MIXED);

  assert.deepEqual(
    rows.map((row) => row.badge),
    ["ROOT", "LEFT", "RIGHT", "LEFT"],
  );
});

test("the leader at the top is the root, not a side", () => {
  const [first] = pathRows(MIXED);

  assert.equal(first.badge, "ROOT");
  assert.equal(first.isRoot, true);
  assert.equal(first.level, 0);
  assert.match(first.accessibilityLabel, /team leader, root position/);
});

test("the member the path describes is the last row, and is marked as such", () => {
  const rows = pathRows(MIXED);

  assert.deepEqual(
    rows.map((row) => row.isTarget),
    [false, false, false, true],
  );
  assert.equal(rows.at(-1)!.name, "Vijay");
  assert.match(rows.at(-1)!.accessibilityLabel, /The member you're looking at/);
});

test("every row above the member is offered as a way to open them", () => {
  const rows = pathRows(MIXED);

  assert.deepEqual(
    rows.slice(0, -1).map((row) => row.accessibilityHint),
    ["Opens this member's details", "Opens this member's details", "Opens this member's details"],
  );
  // The member already on screen is not a link to the screen they are on.
  assert.equal(rows.at(-1)!.accessibilityHint, undefined);
});

test("each row carries the id it opens, so tapping an ancestor opens that member", () => {
  const rows = pathRows(MIXED);

  assert.equal(rows[1].id, "member-ajay");
  assert.equal(rows[2].id, "member-anil");
});

test("the leader's own path is a single root row that is also the target", () => {
  const rows = pathRows([step("Gopinath J UWTC", null)]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].badge, "ROOT");
  assert.equal(rows[0].isRoot, true);
  assert.equal(rows[0].isTarget, true);
  // Not described as "the member you're looking at" on top of being the leader.
  assert.doesNotMatch(rows[0].accessibilityLabel, /looking at/);
});

test("a direct child is the root and then them", () => {
  const rows = pathRows([step("Gopinath J UWTC", null), step("Ajay", "RIGHT")]);

  assert.deepEqual(
    rows.map((row) => [row.badge, row.level, row.isTarget]),
    [
      ["ROOT", 0, false],
      ["RIGHT", 1, true],
    ],
  );
});

test("a deep one-sided path keeps every step rather than summarising it", () => {
  const deep: PathStep[] = [step("Leader", null)];
  for (let level = 1; level <= 40; level += 1) {
    deep.push(step(`Level ${level}`, "LEFT"));
  }

  const rows = pathRows(deep);

  assert.equal(rows.length, 41);
  assert.equal(rows.at(-1)!.level, 40);
  assert.equal(rows.filter((row) => row.badge === "LEFT").length, 40);
  assert.equal(rows.filter((row) => row.isTarget).length, 1);
});

test("a member with no identifier recorded says so rather than showing a gap", () => {
  const rows = pathRows([
    step("Leader", null, { mi_lifestyle_id: null }),
    step("Ajay", "LEFT", { mi_lifestyle_id: "0000000042" }),
  ]);

  assert.equal(rows[0].caption, "No Mi Lifestyle ID");
  // Leading zeros are part of the identifier, not formatting to be tidied away.
  assert.equal(rows[1].caption, "ID 0000000042");
});

test("the one-line summary names every member and every turn", () => {
  assert.equal(
    pathSummary(MIXED),
    "Gopinath J UWTC → LEFT → Ajay → RIGHT → Anil → LEFT → Vijay",
  );
});

test("the summary of the leader's own path is just the leader", () => {
  assert.equal(pathSummary([step("Gopinath J UWTC", null)]), "Gopinath J UWTC");
});

test("depth counts placement levels, and is written the way it is read", () => {
  assert.equal(depthText(0), "Your own position at the top of the team");
  assert.equal(depthText(1), "1 level below you");
  assert.equal(depthText(4), "4 levels below you");
});

test("an empty path produces no rows rather than a fabricated one", () => {
  assert.deepEqual(pathRows([]), []);
  assert.equal(pathSummary([]), "");
});
