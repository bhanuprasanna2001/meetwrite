/** The one transport boundary for the local FastAPI sidecar. */

export const BASE_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8321";

export type ApiErrorKind =
  | "offline"
  | "timeout"
  | "cancelled"
  | "unauthorized"
  | "not-found"
  | "invalid-request"
  | "server"
  | "invalid-response";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly method: string;
  readonly path: string;
  readonly status: number | null;
  readonly originalError: unknown;

  constructor(options: {
    kind: ApiErrorKind;
    method: string;
    path: string;
    message: string;
    status?: number;
    originalError?: unknown;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.kind = options.kind;
    this.method = options.method;
    this.path = options.path;
    this.status = options.status ?? null;
    this.originalError = options.originalError;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function errorKind(status: number): ApiErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not-found";
  if (status >= 500) return "server";
  return "invalid-request";
}

async function responseDetail(response: Response): Promise<string | null> {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    const payload = JSON.parse(text) as { detail?: unknown };
    return typeof payload.detail === "string" ? payload.detail : null;
  } catch {
    return null;
  }
}

export async function requestResponse(
  path: string,
  init?: RequestInit,
  timeoutMs = 30_000,
): Promise<Response> {
  const method = init?.method ?? "GET";
  const headers = new Headers(init?.headers);
  // JSON bodies get the content type; FormData and byte bodies carry their
  // own (setting one here would break the multipart boundary).
  if (typeof init?.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (init?.signal?.aborted) abortFromCaller();
  else init?.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new ApiError({
        kind: "timeout",
        method,
        path,
        message: "The local service took too long to respond.",
        originalError: error,
      });
    }
    if (init?.signal?.aborted) {
      throw new ApiError({
        kind: "cancelled",
        method,
        path,
        message: "The request was cancelled.",
        originalError: error,
      });
    }
    throw new ApiError({
      kind: "offline",
      method,
      path,
      message: "The local service is unavailable. Please reopen meetwrite and try again.",
      originalError: error,
    });
  } finally {
    globalThis.clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", abortFromCaller);
  }

  if (!response.ok) {
    const detail = await responseDetail(response);
    throw new ApiError({
      kind: errorKind(response.status),
      method,
      path,
      status: response.status,
      message: detail ?? `The local service returned ${response.status}.`,
    });
  }
  return response;
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  timeoutMs?: number,
): Promise<T> {
  const response = await requestResponse(path, init, timeoutMs);
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new ApiError({
      kind: "offline",
      method: init?.method ?? "GET",
      path,
      status: response.status,
      message: "The local service response was interrupted.",
      originalError: error,
    });
  }
  if (!text) {
    throw new ApiError({
      kind: "invalid-response",
      method: init?.method ?? "GET",
      path,
      status: response.status,
      message: "The local service returned an empty response.",
    });
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ApiError({
      kind: "invalid-response",
      method: init?.method ?? "GET",
      path,
      status: response.status,
      message: "The local service returned an invalid response.",
      originalError: error,
    });
  }
}

/** Request an endpoint whose successful response intentionally has no JSON body. */
export async function requestVoid(
  path: string,
  init?: RequestInit,
  timeoutMs?: number,
): Promise<void> {
  const response = await requestResponse(path, init, timeoutMs);
  try {
    await response.arrayBuffer();
  } catch (error) {
    throw new ApiError({
      kind: "offline",
      method: init?.method ?? "GET",
      path,
      status: response.status,
      message: "The local service response was interrupted.",
      originalError: error,
    });
  }
}

/** Request a checked binary response, used for the saved WAV. */
export async function requestBytes(
  path: string,
  init?: RequestInit,
  timeoutMs?: number,
): Promise<ArrayBuffer> {
  const response = await requestResponse(path, init, timeoutMs);
  try {
    return await response.arrayBuffer();
  } catch (error) {
    throw new ApiError({
      kind: "offline",
      method: init?.method ?? "GET",
      path,
      status: response.status,
      message: "The local service response was interrupted.",
      originalError: error,
    });
  }
}

function frameData(frame: string): string {
  return frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
}

/** Parse a fetch-based SSE response without assuming network chunk boundaries. */
export async function* readSseJson(
  body: ReadableStream<Uint8Array> | null,
  options: { signal?: AbortSignal; idleTimeoutMs?: number } = {},
): AsyncGenerator<unknown> {
  if (!body) {
    throw new ApiError({
      kind: "invalid-response",
      method: "POST",
      path: "stream",
      message: "The local service returned no response stream.",
    });
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  const abort = () => { void reader.cancel(); };
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      const idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
      let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
      const timeoutResult = new Promise<never>((_resolve, reject) => {
        timeout = globalThis.setTimeout(() => {
          reject(new ApiError({
            kind: "timeout",
            method: "POST",
            path: "stream",
            message: "The reply stream stopped responding.",
          }));
        }, idleTimeoutMs);
      });
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([reader.read(), timeoutResult]);
      } finally {
        if (timeout !== undefined) globalThis.clearTimeout(timeout);
      }
      if (options.signal?.aborted) {
        throw new ApiError({
          kind: "cancelled",
          method: "POST",
          path: "stream",
          message: "The reply stream was cancelled.",
        });
      }
      const { done, value } = chunk;
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const data = frameData(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (data) {
          try {
            yield JSON.parse(data) as unknown;
          } catch (error) {
            throw new ApiError({
              kind: "invalid-response",
              method: "POST",
              path: "stream",
              message: "The local service returned an invalid stream event.",
              originalError: error,
            });
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
      if (done) {
        completed = true;
        break;
      }
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError({
      kind: "offline",
      method: "POST",
      path: "stream",
      message: "The reply stream was interrupted.",
      originalError: error,
    });
  } finally {
    options.signal?.removeEventListener("abort", abort);
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
