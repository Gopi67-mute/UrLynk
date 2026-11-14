import { isApiError } from "@/api/client";
import { useIsOnline } from "@/lib/connectivity";
import { describeFailure } from "@/lib/failure";
import { screenState, type ScreenState } from "@/lib/screen-state";

/** The parts of a TanStack query this needs. Narrow on purpose, so it is easy to fake. */
export type QueryLike = {
  data: unknown;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  /** When the data in hand last came from the server. 0 when it never has. */
  dataUpdatedAt: number;
};

export type ScreenStatus = {
  state: ScreenState;
  /** When this screen's data was last confirmed, or null when it never was. */
  updatedAt: number | null;
};

/**
 * What a screen should be showing for one query, and how old what it shows is.
 *
 * One place, so that Home, Team and a member's record cannot disagree about what a
 * failed refresh or a missing connection means. The judgement itself is in
 * `screenState`, which is plain and tested; this is the wiring that reads a query and
 * the device's connectivity and hands it over.
 *
 * `dataUpdatedAt` is TanStack Query's own record of when the data last came from the
 * server, and it survives being restored from the device — which is precisely what makes
 * "Updated 2 hours ago" true after a cold start rather than a guess.
 */
export function useScreenStatus(query: QueryLike): ScreenStatus {
  const isOnline = useIsOnline();
  const failure = query.error
    ? describeFailure(isApiError(query.error) ? query.error.kind : null, "").kind
    : null;

  return {
    state: screenState({
      hasData: query.data !== undefined,
      isFetching: query.isFetching,
      isError: query.isError,
      failure,
      isOnline,
    }),
    updatedAt: query.dataUpdatedAt || null,
  };
}
