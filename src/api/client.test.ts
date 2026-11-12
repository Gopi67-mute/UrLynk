import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createApiClient, isApiError, type TokenProvider } from "./client.ts";

const BASE_URL = "https://api.example.test";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function errorResponse(status: number, code: string, requestId = "req-1") {
  return jsonResponse(
    { error: { code, message: "whatever", request_id: requestId } },
    status,
  );
}

/** A client whose token provider and fetch are both controllable. */
function clientWith(
  responses: Response[] | ((url: string, init: RequestInit) => Promise<Response>),
  options: {
    token?: string | null;
    /** Pass the key explicitly, even as undefined, to override the default. */
    baseUrl?: string | undefined;
    allowInsecureHttp?: boolean;
  } = {},
) {
  const baseUrl = "baseUrl" in options ? options.baseUrl : BASE_URL;
  const calls: { url: string; init: RequestInit }[] = [];
  const tokenCalls: { forceRefresh: boolean }[] = [];
  const queue = Array.isArray(responses) ? [...responses] : null;

  const getToken: TokenProvider = async ({ forceRefresh }) => {
    tokenCalls.push({ forceRefresh });
    return options.token === undefined ? "token-abc" : options.token;
  };

  const client = createApiClient({
    baseUrl,
    getToken,
    allowInsecureHttp: options.allowInsecureHttp ?? false,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      if (queue) {
        const next = queue.shift();
        if (!next) throw new Error("fetch called more times than expected");
        return next;
      }
      return (responses as (u: string, i: RequestInit) => Promise<Response>)(
        String(url),
        init as RequestInit,
      );
    },
  });

  return { client, calls, tokenCalls };
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return isApiError(error) ? error.kind : `unexpected:${String(error)}`;
  }
}

// --- the happy path ---------------------------------------------------------------

test("a successful request returns the parsed body", async () => {
  const { client, calls } = clientWith([jsonResponse({ team_name: "Asha's Team" })]);

  const body = await client.request<{ team_name: string }>("/api/v1/teams/me");

  assert.equal(body.team_name, "Asha's Team");
  assert.equal(calls[0].url, `${BASE_URL}/api/v1/teams/me`);
});

test("the session token is sent as a bearer token", async () => {
  const { client, calls } = clientWith([jsonResponse({})]);

  await client.request("/api/v1/teams/me");

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer token-abc");
  assert.equal(headers.Accept, "application/json");
});

test("a path without a leading slash is still joined correctly", async () => {
  const { client, calls } = clientWith([jsonResponse({})]);

  await client.request("api/v1/me");

  assert.equal(calls[0].url, `${BASE_URL}/api/v1/me`);
});

test("a body is sent as JSON with a matching content type", async () => {
  const { client, calls } = clientWith([jsonResponse({}, 201)]);

  await client.request("/api/v1/members", { method: "POST", body: { name: "Palanivel" } });

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(calls[0].init.method, "POST");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ name: "Palanivel" }));
});

test("a 204 resolves without a body", async () => {
  const { client } = clientWith([new Response(null, { status: 204 })]);

  assert.equal(await client.request("/api/v1/members"), undefined);
});

test("a public endpoint is called without a token", async () => {
  const { client, calls, tokenCalls } = clientWith([jsonResponse({ status: "ok" })]);

  await client.request("/health", { authenticated: false });

  assert.equal(tokenCalls.length, 0);
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, undefined);
});

// --- sessions ---------------------------------------------------------------------

test("signing out mid-request is reported as unauthorized, with no call made", async () => {
  const { client, calls } = clientWith([], { token: null });

  assert.equal(await kindOf(client.request("/api/v1/teams/me")), "unauthorized");
  assert.equal(calls.length, 0);
});

test("a 401 is retried once with a freshly minted token", async () => {
  const { client, tokenCalls } = clientWith([
    errorResponse(401, "token_expired"),
    jsonResponse({ ok: true }),
  ]);

  const body = await client.request<{ ok: boolean }>("/api/v1/teams/me");

  assert.deepEqual(body, { ok: true });
  assert.deepEqual(tokenCalls, [{ forceRefresh: false }, { forceRefresh: true }]);
});

test("a second 401 means the session itself is gone", async () => {
  const { client, calls } = clientWith([
    errorResponse(401, "token_expired"),
    errorResponse(401, "invalid_token"),
  ]);

  assert.equal(await kindOf(client.request("/api/v1/teams/me")), "unauthorized");
  assert.equal(calls.length, 2); // retried exactly once, not in a loop
});

test("an unauthenticated request is not retried", async () => {
  const { client, calls } = clientWith([errorResponse(401, "not_authenticated")]);

  assert.equal(await kindOf(client.request("/health", { authenticated: false })), "unauthorized");
  assert.equal(calls.length, 1);
});

// --- failures ---------------------------------------------------------------------

test("each status maps to the kind a screen can act on", async () => {
  const cases: [number, string][] = [
    [400, "validation"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [422, "validation"],
    [418, "http"],
    [500, "server"],
    [502, "server"],
    [503, "unavailable"],
  ];

  for (const [status, expected] of cases) {
    const { client } = clientWith([errorResponse(status, "some_code")]);
    assert.equal(await kindOf(client.request("/api/v1/members")), expected, `status ${status}`);
  }
});

test("the backend's error code and request id are kept for diagnosis", async () => {
  const { client } = clientWith([errorResponse(409, "placement_occupied", "req-42")]);

  await assert.rejects(client.request("/api/v1/members"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "placement_occupied");
    assert.equal(error.requestId, "req-42");
    assert.equal(error.status, 409);
    return true;
  });
});

test("an error body that is not JSON still yields a usable error", async () => {
  const { client } = clientWith([
    new Response("<html>gateway</html>", { status: 502, headers: { "X-Request-ID": "req-7" } }),
  ]);

  await assert.rejects(client.request("/api/v1/members"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.kind, "server");
    assert.equal(error.code, null);
    assert.equal(error.requestId, "req-7");
    return true;
  });
});

test("a success that is not JSON is a server error, not a crash", async () => {
  const { client } = clientWith([new Response("not json", { status: 200 })]);

  assert.equal(await kindOf(client.request("/api/v1/teams/me")), "server");
});

test("an unreachable server is a network failure", async () => {
  const { client } = clientWith(async () => {
    throw new TypeError("Network request failed");
  });

  assert.equal(await kindOf(client.request("/api/v1/teams/me")), "network");
});

test("a request that never answers times out", async () => {
  const { client } = clientWith(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );

  assert.equal(
    await kindOf(client.request("/api/v1/teams/me", { timeoutMs: 20 })),
    "timeout",
  );
});

test("a token provider that throws is a network failure, not a crash", async () => {
  const calls: string[] = [];
  const client = createApiClient({
    baseUrl: BASE_URL,
    getToken: async () => {
      calls.push("token");
      throw new Error("Clerk unreachable");
    },
    fetchImpl: async () => jsonResponse({}),
  });

  assert.equal(await kindOf(client.request("/api/v1/teams/me")), "network");
  assert.equal(calls.length, 1);
});

// --- configuration ----------------------------------------------------------------

test("a missing API URL is a configuration error, not a failed request", async () => {
  const { client, calls } = clientWith([], { baseUrl: undefined });

  assert.equal(await kindOf(client.request("/health")), "config");
  assert.equal(calls.length, 0);
});

test("plain http is refused unless development explicitly allows it", async () => {
  const insecure = clientWith([jsonResponse({})], {
    baseUrl: "http://localhost:8000",
    allowInsecureHttp: false,
  });
  assert.equal(await kindOf(insecure.client.request("/health")), "config");

  const allowed = clientWith([jsonResponse({ status: "ok" })], {
    baseUrl: "http://localhost:8000",
    allowInsecureHttp: true,
  });
  await allowed.client.request("/health");
  assert.equal(allowed.calls[0].url, "http://localhost:8000/health");
});

test("a trailing slash on the API URL does not double up", async () => {
  const { client, calls } = clientWith([jsonResponse({})], {
    baseUrl: `${BASE_URL}//`,
  });

  await client.request("/health");

  assert.equal(calls[0].url, `${BASE_URL}/health`);
});

// --- cancellation -----------------------------------------------------------------

test("a caller's cancellation is passed through untouched", async () => {
  const controller = new AbortController();
  const reason = new Error("screen closed");
  controller.abort(reason);

  const { client, calls } = clientWith([jsonResponse({})]);

  await assert.rejects(
    client.request("/api/v1/teams/me", { signal: controller.signal }),
    (error: unknown) => {
      // Not an ApiError: an unmounted screen is not a failure to report.
      assert.equal(error, reason);
      return true;
    },
  );
  assert.equal(calls.length, 0);
});

test("every error kind has a message fit to show a user", () => {
  const kinds = [
    "unauthorized",
    "forbidden",
    "not_found",
    "validation",
    "conflict",
    "server",
    "unavailable",
    "timeout",
    "network",
    "config",
    "http",
  ] as const;

  for (const kind of kinds) {
    const message = new ApiError(kind).userMessage;
    assert.ok(message.length > 0, kind);
    assert.ok(!/undefined|null|\[object/.test(message), `${kind}: ${message}`);
  }
});
