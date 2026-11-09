import { GM_xmlhttpRequest } from "vite-plugin-monkey/dist/client";
import { EventFrames } from "./paperwork-model";

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
        finish(() => reject(new Error("Paperwork service unreachable."))),
      ontimeout: () =>
        finish(() => reject(new Error("Paperwork service timed out."))),
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
  let offset = 0;
  let stopped = false;
  let watchdog: ReturnType<typeof setTimeout>;
  const fail = (error: Error) => {
    if (stopped) return;
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
  const handle = GM_xmlhttpRequest({
    method: "GET",
    url: `${API_URL}/v1/events`,
    anonymous: true,
    headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
    onprogress: (response) => {
      if (stopped) return;
      try {
        if (response.status === 401) throw new ApiError(401, null);
        if (response.status !== 200)
          throw new Error("Paperwork stream unavailable.");
        const text = response.responseText;
        if (text.length < offset || text.length > 1_000_000)
          throw new Error("Refreshing paperwork stream.");
        const chunk = text.slice(offset);
        offset = text.length;
        if (chunk) arm();
        for (const frame of parser.push(chunk))
          onEvent(frame.event, JSON.parse(frame.data));
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Invalid event"));
      }
    },
    onload: (response) =>
      fail(
        response.status === 401
          ? new ApiError(401, null)
          : new Error("Paperwork stream closed."),
      ),
    onerror: () => fail(new Error("Paperwork stream unreachable.")),
    ontimeout: () => fail(new Error("Paperwork stream timed out.")),
  });
  function stop() {
    stopped = true;
    clearTimeout(watchdog);
    handle.abort();
  }
  arm();
  return stop;
}
