import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useApiClient } from "@/api/use-api-client";
import { isApiError } from "@/api/client";
import {
  deleteCachedPhotos,
  readCachedPhoto,
  writeCachedPhoto,
} from "@/cache/sqlite-cache";
import {
  confirmMemberDeletion,
  createMember,
  deleteMember,
  deleteMemberPhoto,
  getMember,
  getMemberChildren,
  getMemberDeletionPlan,
  getMemberPhoto,
  getPlacementPath,
  listMembers,
  listRecentMembers,
  MEMBER_PAGE_SIZE,
  RECENT_MEMBER_COUNT,
  SEARCH_PAGE_SIZE,
  searchMembers,
  setMemberPhoto,
  updateMember,
  type MemberChildren,
  type MemberDeletionPlan,
  type MemberDeletionResult,
  type MemberDetail,
  type MemberListItem,
  type MemberPhoto,
  type MemberPlacementPath,
  type MemberSearchPage,
  type MemberUpdate,
  type NewMember,
  type RecentMember,
} from "@/api/members";
import { useAccountId } from "@/hooks/use-account-id";
import { queryKeys } from "@/query/keys";

/** A member's direct LEFT and RIGHT slots. Two members, never a subtree. */
export function useMemberChildren(memberId: string | undefined): UseQueryResult<MemberChildren> {
  const client = useApiClient();
  const accountId = useAccountId();

  return useQuery({
    queryKey: queryKeys.memberChildren(accountId ?? "none", memberId ?? "none"),
    queryFn: ({ signal }) => getMemberChildren(client, memberId!, signal),
    enabled: accountId !== null && Boolean(memberId),
  });
}

export function useMember(memberId: string | undefined): UseQueryResult<MemberDetail> {
  const client = useApiClient();
  const accountId = useAccountId();

  return useQuery({
    queryKey: queryKeys.member(accountId ?? "none", memberId ?? "none"),
    queryFn: ({ signal }) => getMember(client, memberId!, signal),
    enabled: accountId !== null && Boolean(memberId),
  });
}

/**
 * The team directory, one page at a time.
 *
 * Used by the placement-parent picker. Pages are fetched as the list is scrolled, so
 * a large team costs the same to open as a small one.
 */
export function useMemberDirectory() {
  const client = useApiClient();
  const accountId = useAccountId();

  const query = useInfiniteQuery({
    queryKey: queryKeys.members(accountId ?? "none"),
    queryFn: ({ pageParam, signal }) =>
      listMembers(client, { cursor: pageParam, limit: MEMBER_PAGE_SIZE, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    enabled: accountId !== null,
  });

  const members: MemberListItem[] = query.data?.pages.flatMap((page) => page.items) ?? [];
  return { ...query, members };
}

/**
 * Members of this team matching a search query.
 *
 * Three things keep an out-of-date response off the screen, and they work together:
 *
 * - the query is part of the query key, so a result for "aja" is cached under "aja" and
 *   can never be rendered as the answer to "ajay". This is what makes the usual
 *   race — a slow earlier request landing after a fast later one — structurally
 *   impossible rather than something to guard against;
 * - the request carries the query's `signal`, so a search left behind by the next
 *   keystroke is actually cancelled rather than merely ignored;
 * - the screen compares what is typed with what the results belong to (`searchState`),
 *   so the gap while the field settles reads as "searching" rather than as an answer.
 *
 * A blank query is never sent: the hook stays disabled until there is something to
 * search for, so an empty field costs nothing and the backend's own refusal of a blank
 * query is only ever a backstop.
 *
 * `staleTime` is longer than the default because a leader typing, deleting a character
 * and typing it again should read the result they just saw rather than ask for it
 * twice. Member edits invalidate the whole account, so a change still reaches it.
 */
export function useMemberSearch(query: string): UseQueryResult<MemberSearchPage> {
  const client = useApiClient();
  const accountId = useAccountId();
  const term = query.trim();

  return useQuery({
    queryKey: queryKeys.memberSearch(accountId ?? "none", term),
    queryFn: ({ signal }) =>
      searchMembers(client, term, { limit: SEARCH_PAGE_SIZE, signal }),
    enabled: accountId !== null && term.length > 0,
    staleTime: 60_000,
  });
}

/**
 * The exact chain of placements from the team's root down to one member.
 *
 * One request for the whole path, calculated in the database. The app never walks the
 * tree itself, and never asks for one ancestor at a time.
 *
 * Kept under the member's own key, so a deletion drops it along with their record and
 * any change to the team refreshes it — which is what makes the path describe where
 * someone sits now rather than where they used to.
 */
export function usePlacementPath(
  memberId: string | undefined,
): UseQueryResult<MemberPlacementPath> {
  const client = useApiClient();
  const accountId = useAccountId();

  return useQuery({
    queryKey: queryKeys.placementPath(accountId ?? "none", memberId ?? "none"),
    queryFn: ({ signal }) => getPlacementPath(client, memberId!, signal),
    enabled: accountId !== null && Boolean(memberId),
  });
}

/**
 * Register a member.
 *
 * On success every cached query for this account is invalidated: counts, the
 * directory, the parent's children and the parent's own slot flags all change at
 * once, and refetching them is cheaper than trying to patch each one by hand.
 */
export function useCreateMember() {
  const client = useApiClient();
  const accountId = useAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (member: NewMember) => createMember(client, member),
    onSuccess: () => {
      if (accountId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.account(accountId) });
      }
    },
  });
}

/**
 * The team's most recently registered members.
 *
 * Its own query, so Home renders without waiting for it and its own failure is shown
 * in that one section rather than taking the dashboard down with it.
 */
export function useRecentMembers(): UseQueryResult<RecentMember[]> {
  const client = useApiClient();
  const accountId = useAccountId();

  return useQuery({
    queryKey: queryKeys.recentMembers(accountId ?? "none"),
    queryFn: ({ signal }) =>
      listRecentMembers(client, { limit: RECENT_MEMBER_COUNT, signal }),
    enabled: accountId !== null,
  });
}

/**
 * Change a member's own details.
 *
 * Everything for this account is invalidated on success, because one edit can change
 * more than one screen at once: a renamed leader appears on Home, on Team, in the
 * Recently Added parent column and on their own record. Refetching is both simpler
 * and more honest than patching each cached copy by hand.
 */
export function useUpdateMember(memberId: string | undefined) {
  const client = useApiClient();
  const accountId = useAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (changes: MemberUpdate) => updateMember(client, memberId!, changes),
    onSuccess: (updated) => {
      if (!accountId) return;
      // The fresh record first, so the screen the user is on updates immediately.
      queryClient.setQueryData(queryKeys.member(accountId, updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.account(accountId) });
    },
  });
}

/**
 * Permanently delete one member.
 *
 * Everything for this account is invalidated on success, for the same reason an edit
 * is: one removal changes the team counts, the directory, Recently Added, and the
 * parent's free slots at once. The member's own cached record is dropped outright
 * rather than refetched — there is nothing left to fetch, and leaving it would let a
 * screen render a member who no longer exists.
 *
 * The mutation's own `isPending` is what stops a second submission: the caller disables
 * its action while it runs, so a double tap cannot send two deletions.
 */
export function useDeleteMember(memberId: string | undefined) {
  const client = useApiClient();
  const accountId = useAccountId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteMember(client, memberId!),
    onSuccess: () => {
      if (!accountId || !memberId) return;

      queryClient.removeQueries({ queryKey: queryKeys.member(accountId, memberId) });
      // Their photograph goes with the record: a deleted member's face has nothing left
      // to belong to, and keeping it would leave an image of a person on the device
      // after the leader removed them.
      void deleteCachedPhotos(accountId, memberId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.account(accountId) });
    },
  });
}

/**
 * What deleting this member would do.
 *
 * A read, and only a read: asking does not reserve a position or change anything, so
 * the leader can look at both options and walk away.
 *
 * `promote` is the member they chose to take the deleted member's position, and it is
 * part of the query key — switching between the two candidates fetches each plan once
 * and then reads it from cache. The plan is never cached beyond this screen: it
 * describes a tree that another device could change, and confirming a plan the backend
 * no longer agrees with is refused rather than applied.
 */
export function useMemberDeletionPlan(
  memberId: string | undefined,
  promote: string | null,
  options: { enabled?: boolean } = {},
): UseQueryResult<MemberDeletionPlan> {
  const client = useApiClient();
  const accountId = useAccountId();

  return useQuery({
    queryKey: queryKeys.memberDeletionPlan(accountId ?? "none", memberId ?? "none", promote),
    queryFn: ({ signal }) => getMemberDeletionPlan(client, memberId!, { promote, signal }),
    enabled: accountId !== null && Boolean(memberId) && (options.enabled ?? true),
    // Always fetched fresh when the screen opens, and never cached past it, so a plan
    // is never served from an earlier visit.
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // ...but never refetched underneath the leader while they are reading it. A plan is
    // a snapshot they are deciding on, and replacing it mid-review re-renders the
    // screen, resets its scroll position and moves the confirm button out from under
    // their finger — on a destructive screen, the worst possible moment to move
    // anything. Refetching here is also unnecessary: the plan token is checked against
    // the live tree when they confirm, so a team that changed in the meantime is
    // refused and the new plan is fetched then.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * Reorganize the team and delete the member, in one confirmed step.
 *
 * On success everything for this account is invalidated — counts, the directory,
 * Recently Added, and the children of every member whose slots just changed — and the
 * deleted member's own cached record is dropped outright, because there is nothing left
 * to fetch and leaving it would let a screen render a member who no longer exists. The
 * promoted and reattached members are invalidated along with the rest, so their new
 * positions are read from the server rather than guessed at here.
 *
 * Every plan for this member is dropped too: they are all descriptions of a tree that
 * has just changed.
 *
 * The mutation's own `isPending` is what stops a second submission — the screen
 * disables its confirm action while it runs, so a double tap cannot send two.
 */
export function useConfirmMemberDeletion(memberId: string | undefined) {
  const client = useApiClient();
  const accountId = useAccountId();
  const queryClient = useQueryClient();

  return useMutation<
    MemberDeletionResult,
    Error,
    { promoteMemberId?: string | null; planToken: string }
  >({
    mutationFn: (body) => confirmMemberDeletion(client, memberId!, body),
    onSuccess: () => {
      if (!accountId || !memberId) return;

      queryClient.removeQueries({ queryKey: queryKeys.member(accountId, memberId) });
      void deleteCachedPhotos(accountId, memberId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.account(accountId) });
    },
  });
}

/**
 * A member's profile photo, or null when they have none.
 *
 * `version` is the member's `photo_updated_at`: it keys the cache, so a photo is
 * fetched once per version and a changed one is never served stale. Passing null means
 * the member has no photo, and nothing is requested at all.
 *
 * **The device is asked before the server is.** A photo for a given version never
 * changes — that is what makes the version a version — so a copy on the device is not a
 * stale copy, it is the same bytes. A dashboard holds up to eight faces, and on a cold
 * start every one of them used to be a request; now they are a local read each, and the
 * network is only involved the first time a face is ever seen. It is also what lets a
 * leader see their team's photographs with no connection at all.
 *
 * What comes back from the server is written to the device on the way through, so the
 * next launch is free. That write is fire-and-forget on purpose: a full disk must cost a
 * slower start next time, never a photo that fails to appear now.
 *
 * "This member has no photo" is a normal answer, not an error: it resolves to null so
 * the caller simply draws initials.
 */
export function useMemberPhoto(
  memberId: string | undefined,
  version: string | null | undefined,
): UseQueryResult<MemberPhoto | null> {
  const client = useApiClient();
  const accountId = useAccountId();

  return useQuery({
    queryKey: queryKeys.memberPhoto(accountId ?? "none", memberId ?? "none", version ?? null),
    queryFn: async ({ signal }) => {
      const cached = await readCachedPhoto(accountId!, memberId!, version!);
      if (cached) return cached;

      try {
        const photo = await getMemberPhoto(client, memberId!, signal);
        void writeCachedPhoto(accountId!, photo);
        return photo;
      } catch (error) {
        if (isApiError(error) && error.code === "photo_not_found") return null;
        throw error;
      }
    },
    enabled: accountId !== null && Boolean(memberId) && Boolean(version),
    // The bytes for a given version never change, so there is nothing to refresh.
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    // The one query in the app that must still run with no connection.
    //
    // Every other query needs the server, so pausing it offline is right: it keeps
    // cached data on screen instead of replacing it with a failure. This one looks on
    // the device first, and pausing it would mean a leader with no connection saw
    // initials in place of faces that are already stored on their phone. `offlineFirst`
    // lets the attempt happen; the local read answers it, and a member whose photo has
    // never been downloaded simply falls back to initials, as they already do.
    networkMode: "offlineFirst",
    // ...but a miss offline must not be retried into a loop of failing requests. One
    // attempt, then initials until there is a connection again.
    retry: false,
  });
}

/** Set, replace or remove a member's photo. `null` removes it. */
export function useSaveMemberPhoto(memberId: string | undefined) {
  const client = useApiClient();
  const accountId = useAccountId();
  const queryClient = useQueryClient();

  return useMutation<MemberPhoto | null, Error, { content_type: string; data: string } | null>({
    mutationFn: async (photo) => {
      if (photo === null) {
        await deleteMemberPhoto(client, memberId!);
        return null;
      }
      return setMemberPhoto(client, memberId!, photo);
    },
    onSuccess: (photo) => {
      if (!accountId || !memberId) return;

      // Drop every cached version of this member's photo, then put the new one in under
      // its own version. The member record carries that same version, so once it
      // refreshes, every avatar in the app reads this entry — with no second request
      // for an image the device has just uploaded.
      queryClient.removeQueries({
        queryKey: [...queryKeys.member(accountId, memberId), "photo"],
      });
      if (photo) {
        queryClient.setQueryData(
          queryKeys.memberPhoto(accountId, memberId, photo.updated_at),
          photo,
        );
      }

      // The same correction on the device, so the old face cannot come back on the next
      // cold start. Removing first covers the `null` case — a photo that was deleted —
      // where there is nothing to write in its place.
      void deleteCachedPhotos(accountId, memberId).then(() => {
        if (photo) return writeCachedPhoto(accountId, photo);
      });

      void queryClient.invalidateQueries({ queryKey: queryKeys.account(accountId) });
    },
  });
}
