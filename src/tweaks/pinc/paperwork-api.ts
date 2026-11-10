import { GM_xmlhttpRequest } from "vite-plugin-monkey/dist/client";
import { EventFrames } from "./paperwork-model";
import { createLogger } from "../helpers";

const logger = createLogger("paperwork-api");

export const API_URL = (
  import.meta.env.VITE_PAPERWORK_API_URL || "http://127.0.0.1:8080"
).replace(/\/$/, "");
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(
      status === 401
        ? "Device access rejected. Forget this device and enroll again."
        : `Paperwork request failed (${status}).`,
    );
  }
}

export function request(
  method: "GET" | "POST" | "PUT",
  path: string,
  token: string | undefined,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Request canceled"));
      return;
    }
    const endpoint = path.startsWith("/v1/paperwork/")
      ? "/v1/paperwork/:shipmentId"
      : path;
    const started = performance.now();
    logger.log("request started", { method, endpoint });
    const finish = (action: () => void) => {
      signal.removeEventListener("abort", abort);
      action();
    };
    const handle = GM_xmlhttpRequest({
      method,
      url: `${API_URL}${path}`,
      anonymous: true,
      timeout: 10000,
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      data: body ? JSON.stringify(body) : undefined,
      onload: (response) =>
        finish(() => {
          logger.log("request completed", {
            method,
            endpoint,
            status: response.status,
            durationMs: Math.round(performance.now() - started),
          });
          try {
            if (
              response.finalUrl &&
              new URL(response.finalUrl).origin !== new URL(API_URL).origin
            )
              throw new Error("Unexpected API redirect");
            const value: unknown = JSON.parse(response.responseText);
            if (response.status < 200 || response.status >= 300)
              throw new ApiError(response.status, value);
            resolve(value);
          } catch (error) {
            reject(error);
          }
        }),
      onerror: () =>
        finish(() => {
          logger.warn("request failed", { method, endpoint });
          reject(new Error("Paperwork service unreachable."));
        }),
      ontimeout: () =>
        finish(() => {
          logger.warn("request timed out", { method, endpoint });
          reject(new Error("Paperwork service timed out."));
        }),
      onabort: () => finish(() => reject(new Error("Request canceled"))),
    });
    function abort() {
      handle.abort();
      finish(() => reject(new Error("Request canceled")));
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function stream(
  token: string,
  onEvent: (event: string, data: unknown) => void,
  onFailure: (error: Error) => void,
): () => void {
  const parser = new EventFrames();
  let stopped = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let handle: { abort: () => void } | undefined;
  let watchdog: ReturnType<typeof setTimeout>;
  const fail = (error: Error) => {
    if (stopped) return;
    logger.warn("SSE failed", {
      reason:
        error instanceof ApiError ? `HTTP ${error.status}` : error.message,
    });
    stop();
    onFailure(error);
  };
  const arm = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(
      () => fail(new Error("Paperwork stream stalled.")),
      45000,
    );
  };
  async function consume() {
    const decoder = new TextDecoder();
    try {
      while (!stopped && reader) {
        const { done, value } = await reader.read();
        if (stopped) return;
        if (done) {
          fail(new Error("Paperwork stream closed."));
          return;
        }
        if (!value.byteLength) continue;
        arm();
        logger.log("SSE chunk received", { bytes: value.byteLength });
        for (const frame of parser.push(
          decoder.decode(value, { stream: true }),
        )) {
          if (stopped) return;
          logger.log("SSE event received", { event: frame.event });
          onEvent(frame.event, JSON.parse(frame.data));
        }
      }
    } catch {
      fail(new Error("Paperwork stream read or event processing failed."));
    }
  }
  logger.log("SSE request started");
  arm();
  handle = GM_xmlhttpRequest({
    method: "GET",
    url: `${API_URL}/v1/events`,
    anonymous: true,
    responseType: "stream",
    headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
    onloadstart: (response) => {
      if (stopped) return;
      try {
        if (response.status === 401) throw new ApiError(401, null);
        if (response.status !== 200)
          throw new Error("Paperwork stream unavailable.");
        if (
          response.finalUrl &&
          new URL(response.finalUrl).origin !== new URL(API_URL).origin
        )
          throw new Error("Unexpected API redirect");
        if (!response.response?.getReader)
          throw new Error(
            "Browser did not provide a paperwork response stream.",
          );
        reader = response.response.getReader();
        logger.log("SSE response opened", { status: response.status });
        void consume();
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Invalid stream"));
      }
    },
    onload: (response) => {
      if (response.status === 401) fail(new ApiError(401, null));
      else if (!reader) fail(new Error("Paperwork stream closed."));
    },
    onerror: () => fail(new Error("Paperwork stream unreachable.")),
    ontimeout: () => fail(new Error("Paperwork stream timed out.")),
    onabort: () => fail(new Error("Paperwork stream aborted.")),
  });
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(watchdog);
    void reader?.cancel().catch(() => {});
    handle?.abort();
    logger.log("SSE stopped");
  }
  if (stopped) handle.abort();
  return stop;
}
