import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useApiClient } from "@/api/use-api-client";
import { getTeamOverview, type TeamOverview } from "@/api/teams";
import { useLeaderName } from "@/auth/account";
import { useAccountId } from "@/hooks/use-account-id";
import { queryKeys } from "@/query/keys";

/**
 * The signed-in leader's team, its root member and its counts.
 *
 * Shared by Home and Team: both read the same cache entry, so opening one after the
 * other makes no second request.
 */
export function useTeamOverview(): UseQueryResult<TeamOverview> {
  const client = useApiClient();
  const accountId = useAccountId();
  const leaderName = useLeaderName();

  return useQuery({
    queryKey: queryKeys.team(accountId ?? "none"),
    queryFn: ({ signal }) => getTeamOverview(client, { displayName: leaderName, signal }),
    enabled: accountId !== null,
  });
}
