import { colors, statusColors } from "./colors";

/**
 * One colour per side of the binary structure, used everywhere a placement appears:
 * green for LEFT, blue for RIGHT. Violet stays reserved for actions.
 */
export const placementStyle = {
  LEFT: {
    label: "LEFT",
    title: "Left Team",
    accent: colors.brand.green,
    tint: statusColors.success.background,
  },
  RIGHT: {
    label: "RIGHT",
    title: "Right Team",
    accent: colors.brand.blue,
    tint: statusColors.info.background,
  },
} as const;

export type PlacementSide = keyof typeof placementStyle;
