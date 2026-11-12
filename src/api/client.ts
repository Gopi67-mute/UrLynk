/**
 * The single HTTP client for the UrLynk backend.
 *
 * Kept free of React and Clerk imports so its behaviour can be tested on its own;
 * `useApiClient` wires in the Clerk session token. Tokens are never logged.
 */

export type ApiErrorKind =
  | "unauthorized" // 401: no valid session; signing in again is the fix
  | "forbidden" // 403: signed in, but not allowed
  | "not_found" // 404
  | "validation" // 400 / 422: the request content was rejected
  | "conflict" // 409
  | "server" // 5xx other than 503, or an unreadable response
  | "unavailable" // 503: backend or a dependency is temporarily down
  | "timeout" // no response within the time limit
  | "network" // the request never reached the server
  | "config" // the app is missing or misconfigured for the API
  | "http"; // any other non-success status

const USER_MESSAGES: Record<ApiErrorKind, string> = {
  unauthorized: "Your session has ended. Please sign in again.",
  forbidden: "You don't have access to this.",
  not_found: "We couldn't find what you were looking for.",
  validation: "Some of the details aren't valid. Check them and try again.",
  conflict: "This changed in the meantime. Refresh and try again.",
  server: "Something went wrong on our side. Please try again.",
  unavailable: "UrLynk is temporarily unavailable. Please try again shortly.",
  timeout: "The server took too long to respond. Please try again.",
  network: "We couldn't reach UrLynk. Check your connection and try again.",
  config: "The app isn't set up to reach the server.",
  http: "We couldn't complete that request. Please try again.",
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status, or null when no response was received. */
  readonly status: number | null;
  /** The backend's machine-readable error code, when it sent one. */
  readonly code: string | null;
  readonly requestId: string | null;

  constructor(
    kind: ApiErrorKind,
    options: { status?: number | null; code?: string | null; requestId?: string | null } = {},
  ) {
    super(USER_MESSAGES[kind]);
    this.name = "ApiError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.requestId = options.requestId ?? null;
  }

  /** Safe to show to the user. */
  get userMessage(): string {
    return USER_MESSAGES[this.kind];
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Returns the current session token, or null when signed out.
 * `forceRefresh` asks for a newly minted token instead of a cached one.
 */
export type TokenProvider = (options: { forceRefresh: boolean }) => Promise<string | null>;

export type ApiClientOptions = {
  baseUrl: string | undefined;
  getToken: TokenProvider;
  timeoutMs?: number;
  /** Plain http:// is only acceptable for local development (e.g. over `adb reverse`). */
  allowInsecureHttp?: boolean;
  fetchImpl?: typeof fetch;
};

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Public endpoints such as /health skip the token. Defaults to true. */
  authenticated?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ApiClient = {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "validation";
  if (status === 409) return "conflict";
  if (status === 503) return "unavailable";
  if (status >= 500) return "server";
  return "http";
}

function normalizeBaseUrl(
  baseUrl: string | undefined,
  allowInsecureHttp: boolean,
): string | ApiError {
  const trimmed = baseUrl?.trim().replace(/\/+$/, "");
  if (!trimmed) return new ApiError("config");
  if (trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("http://") && allowInsecureHttp) return trimmed;
  return new ApiError("config");
}

async function readErrorBody(
  response: Response,
): Promise<{ code: string | null; requestId: string | null }> {
  const headerRequestId = response.headers.get("X-Request-ID");
  try {
    const body: unknown = await response.json();
    const error =
      body && typeof body === "object" && "error" in body
        ? (body as { error?: { code?: unknown; request_id?: unknown } }).error
        : undefined;
    return {
      code: typeof error?.code === "string" ? error.code : null,
      requestId:
        typeof error?.request_id === "string" ? error.request_id : headerRequestId,
    };
  } catch {
    return { code: null, requestId: headerRequestId };
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function send(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
  ): Promise<Response> {
    if (callerSignal?.aborted) throw callerSignal.reason ?? new Error("Aborted");

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const forwardAbort = () => controller.abort();
    callerSignal?.addEventListener("abort", forwardAbort);

    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) throw new ApiError("timeout");
      // The caller cancelled (e.g. the screen unmounted): pass that through untouched.
      if (callerSignal?.aborted) throw error;
      throw new ApiError("network");
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", forwardAbort);
    }
  }

  async function request<T>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
    const baseUrl = normalizeBaseUrl(options.baseUrl, options.allowInsecureHttp ?? false);
    if (baseUrl instanceof ApiError) throw baseUrl;

    const {
      method = "GET",
      body,
      authenticated = true,
      signal,
      timeoutMs = defaultTimeoutMs,
    } = requestOptions;
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    async function attempt(forceRefresh: boolean): Promise<Response> {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";

      if (authenticated) {
        let token: string | null;
        try {
          token = await options.getToken({ forceRefresh });
        } catch {
          throw new ApiError("network");
        }
        if (!token) throw new ApiError("unauthorized");
        headers.Authorization = `Bearer ${token}`;
      }

      return send(
        url,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
        timeoutMs,
        signal,
      );
    }

    let response = await attempt(false);
    // A cached token can expire between minting and arrival. Retry once with a fresh
    // one; a second 401 means the session itself is no longer valid.
    if (response.status === 401 && authenticated) {
      response = await attempt(true);
    }

    if (!response.ok) {
      const { code, requestId } = await readErrorBody(response);
      throw new ApiError(kindForStatus(response.status), {
        status: response.status,
        code,
        requestId,
      });
    }

    if (response.status === 204) return undefined as T;

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError("server", {
        status: response.status,
        requestId: response.headers.get("X-Request-ID"),
      });
    }
  }

  return { request };
}
