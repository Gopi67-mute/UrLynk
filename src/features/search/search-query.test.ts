import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSearchable,
  normalizeQuery,
  placementText,
  resultCountText,
  searchState,
} from "./search-query.ts";

const READY = { isPending: false, isError: false };

test("a query is sent without its surrounding whitespace", () => {
  assert.equal(normalizeQuery("  Ajay  "), "Ajay");
  assert.equal(normalizeQuery("\t0012345678\n"), "0012345678");
  // Spaces inside a name are part of it.
  assert.equal(normalizeQuery("  Meera Nair  "), "Meera Nair");
});

test("a field holding nothing but whitespace is an empty field", () => {
  assert.equal(isSearchable(""), false);
  assert.equal(isSearchable("   "), false);
  assert.equal(isSearchable("\t\n"), false);
  assert.equal(isSearchable("a"), true);
  assert.equal(isSearchable("  7  "), true);
});

test("before anything is typed, the screen is in its opening state", () => {
  assert.equal(
    searchState({ typed: "", submitted: "", resultCount: null, ...READY }),
    "idle",
  );
});

test("clearing the field restores the opening state, results and all", () => {
  // Results from the previous query are still in hand; an empty field still wins.
  assert.equal(
    searchState({ typed: "", submitted: "Ajay", resultCount: 3, ...READY }),
    "idle",
  );
  assert.equal(
    searchState({ typed: "   ", submitted: "Ajay", resultCount: 0, ...READY }),
    "idle",
  );
});

test("typing something not yet searched for reads as searching, not as results", () => {
  // The field says "ajay"; the results in hand are the answer to "aja".
  assert.equal(
    searchState({ typed: "ajay", submitted: "aja", resultCount: 3, ...READY }),
    "searching",
  );
});

test("a stale failure never stands as the verdict on a query that has since changed", () => {
  const state = searchState({
    typed: "ajay",
    submitted: "aja",
    isPending: false,
    isError: true,
    resultCount: null,
  });

  assert.equal(state, "searching");
});

test("a stale empty answer never reads as no results for the newer query", () => {
  const state = searchState({
    typed: "Meera",
    submitted: "Meer",
    resultCount: 0,
    ...READY,
  });

  assert.notEqual(state, "no-results");
  assert.equal(state, "searching");
});

test("a request in flight for the current query reads as searching", () => {
  assert.equal(
    searchState({
      typed: "Ajay",
      submitted: "Ajay",
      isPending: true,
      isError: false,
      resultCount: null,
    }),
    "searching",
  );
});

test("a failure is reported as a failure, not as an empty team", () => {
  assert.equal(
    searchState({
      typed: "Ajay",
      submitted: "Ajay",
      isPending: false,
      isError: true,
      resultCount: 0,
    }),
    "error",
  );
});

test("a search that matched nobody says so", () => {
  assert.equal(
    searchState({ typed: "Nobody", submitted: "Nobody", resultCount: 0, ...READY }),
    "no-results",
  );
});

test("matches are shown once the request they belong to has come back", () => {
  assert.equal(
    searchState({ typed: "Ajay", submitted: "Ajay", resultCount: 2, ...READY }),
    "results",
  );
  // The typed query's whitespace is not a difference: it is not part of the query.
  assert.equal(
    searchState({ typed: " Ajay ", submitted: "Ajay", resultCount: 2, ...READY }),
    "results",
  );
});

test("an answer that has not arrived is not an empty answer", () => {
  assert.equal(
    searchState({ typed: "Ajay", submitted: "Ajay", resultCount: null, ...READY }),
    "searching",
  );
});

test("the result count is written the way it is read", () => {
  assert.equal(resultCountText(0, false), "No members found");
  assert.equal(resultCountText(1, false), "1 member found");
  assert.equal(resultCountText(7, false), "7 members found");
});

test("a page that is not the whole answer does not claim to be", () => {
  assert.equal(resultCountText(25, true), "First 25 members");
  assert.doesNotMatch(resultCountText(25, true), /found/);
});

test("a result's placement reads as a position under a named member", () => {
  assert.equal(placementText("LEFT", "Ajay"), "LEFT under Ajay");
  assert.equal(placementText("RIGHT", "Meera Nair"), "RIGHT under Meera Nair");
});

test("a position with no parent named still states the side", () => {
  assert.equal(placementText("LEFT", null), "LEFT");
});

test("the leader's own record has no placement to state", () => {
  assert.equal(placementText(null, null), null);
  assert.equal(placementText(null, "Anyone"), null);
});

// Search is the one screen that genuinely cannot work offline: the matching runs in
// PostgreSQL over the whole team, and filtering a downloaded directory on the phone is
// exactly what this feature was built not to do.
test("offline with no answer in hand says the search needs a connection", () => {
  assert.equal(
    searchState({
      typed: "Ajay",
      submitted: "Ajay",
      resultCount: null,
      isOnline: false,
      ...READY,
    }),
    "offline",
  );
});

test("results already fetched stay readable when the connection goes", () => {
  assert.equal(
    searchState({ typed: "Ajay", submitted: "Ajay", resultCount: 3, isOnline: false, ...READY }),
    "results",
  );
  assert.equal(
    searchState({ typed: "Ajay", submitted: "Ajay", resultCount: 0, isOnline: false, ...READY }),
    "no-results",
  );
});

test("a search still being typed reads as searching, not as offline", () => {
  assert.equal(
    searchState({
      typed: "Ajay",
      submitted: "Aja",
      resultCount: null,
      isOnline: false,
      ...READY,
    }),
    "searching",
  );
});

test("online with nothing back yet is still searching", () => {
  assert.equal(
    searchState({ typed: "Ajay", submitted: "Ajay", resultCount: null, ...READY }),
    "searching",
  );
});
