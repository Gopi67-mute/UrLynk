export type SlotState = "loading" | "unavailable" | "filled" | "open";

/**
 * What a LEFT or RIGHT position can honestly be said to be right now.
 *
 * "unavailable" is the one that matters: when the request for a parent's two members
 * fails, the position is not *known* to be open. Drawing it as open would invite a
 * placement into a slot that may already be taken, and the backend would then reject
 * it. The screens show "Not available" and offer a refresh instead.
 *
 * Checked in this order on purpose: a failed request is reported even while a second,
 * dependent request is still disabled and therefore reads as pending.
 */
export function slotState(
  pending: boolean,
  error: unknown,
  member: unknown | null,
): SlotState {
  if (error) return "unavailable";
  if (pending) return "loading";
  return member ? "filled" : "open";
}
