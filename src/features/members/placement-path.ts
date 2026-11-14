/**
 * The placement path as rows on a screen, decided without React.
 *
 * The backend sends the chain itself — root first, the member last, each step carrying
 * the side it occupies under the one before it. This turns that into what each row says:
 * its badge, its caption, whether it is the member the leader asked about, and what a
 * screen reader hears. Nothing here calculates a path; inventing one from order or
 * identifiers is exactly what the feature must not do.
 */

export type PathSide = "LEFT" | "RIGHT";

/** A step as the API sends it: just the parts a row needs. */
export type PathStep = {
  id: string;
  name: string;
  mi_lifestyle_id: string | null;
  /** The side this step occupies under the step before it; null for the root. */
  placement_position: PathSide | null;
  is_root: boolean;
};

export type PathRow = {
  id: string;
  name: string;
  /** ROOT for the team leader, otherwise the side this member sits on. */
  badge: "ROOT" | PathSide;
  /** The member's identifier, or a plain note that none is recorded. */
  caption: string;
  /** How far below the root: 0 for the root itself. */
  level: number;
  /** True for the one member the path was asked about. */
  isTarget: boolean;
  /** True for the team leader at the top. */
  isRoot: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
};

/**
 * One row per step, in the order they are read: the leader first, the member last.
 *
 * The target is the last step, because the path *ends* at the member it describes — not
 * whichever row happens to match an id passed around separately.
 *
 * A step's badge comes from its own `placement_position`, which is the side it occupies
 * under the row above it. The root has none and is badged ROOT instead, which is true
 * rather than a missing value dressed up.
 */
export function pathRows(steps: PathStep[]): PathRow[] {
  return steps.map((step, index) => {
    const isTarget = index === steps.length - 1;
    const isRoot = step.is_root || index === 0;
    const badge: "ROOT" | PathSide = step.placement_position ?? "ROOT";
    const caption = step.mi_lifestyle_id
      ? `ID ${step.mi_lifestyle_id}`
      : "No Mi Lifestyle ID";

    const position = isRoot
      ? "team leader, root position"
      : `${step.placement_position} position`;
    const role = isTarget && !isRoot ? ". The member you're looking at" : "";

    return {
      id: step.id,
      name: step.name,
      badge,
      caption,
      level: index,
      isTarget,
      isRoot,
      accessibilityLabel: `Step ${index + 1} of ${steps.length}: ${step.name}, ${position}${role}`,
      accessibilityHint: isTarget ? undefined : "Opens this member's details",
    };
  });
}

/**
 * The path in one line: "Gopinath → LEFT → Ajay → RIGHT → Anil".
 *
 * A summary for the top of the screen, so the shape of the path is readable before
 * scrolling it. Built from the same steps as the rows, so the two cannot disagree.
 */
export function pathSummary(steps: PathStep[]): string {
  return steps
    .map((step, index) =>
      index === 0 ? step.name : `${step.placement_position} → ${step.name}`,
    )
    .join(" → ");
}

/**
 * How deep the member sits, in words.
 *
 * Counts placement edges, not members: the leader's direct LEFT member is one level
 * below them, whatever order anyone was registered in.
 */
export function depthText(depth: number): string {
  if (depth === 0) return "Your own position at the top of the team";
  if (depth === 1) return "1 level below you";
  return `${depth} levels below you`;
}
