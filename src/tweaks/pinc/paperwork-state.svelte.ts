import {
  GM_addValueChangeListener,
  GM_deleteValue,
  GM_getValue,
  GM_removeValueChangeListener,
  GM_setValue,
} from "vite-plugin-monkey/dist/client";
import { API_URL, ApiError, request, stream } from "./paperwork-api";
import { createLogger } from "../helpers";
import {
  snapshot,
  status,
  validShipmentId,
  type Row,
  type Status,
} from "./paperwork-model";

const KEY = "paperwork-device:v1";
const logger = createLogger("paperwork");
type Device = {
  token: string;
  deviceId: string;
  transport: "poll" | "sse";
  apiUrl: string;
};
type Phase =
  | "off"
  | "setup"
  | "connecting"
  | "connected"
  | "saving"
  | "disconnected"
  | "unauthorized";

class PaperworkState {
  phase = $state<Phase>("off");
  notice = $state("");
  configured = $state(false);
  transport = $state<"poll" | "sse">("poll");
  rows = new Map<string, Status>();
  private device: Device | undefined;
  private listeners = new Set<() => void>();
  private active = false;
  private generation = 0;
  private controller = new AbortController();
  private closeStream: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private enrollment: AbortController | undefined;

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private load() {
    const device = GM_getValue<Device | undefined>(KEY, undefined);
    this.device =
      device &&
      device.apiUrl === API_URL &&
      typeof device.token === "string" &&
      typeof device.deviceId === "string"
        ? device
        : undefined;
    this.configured = !!this.device;
    this.transport = this.device?.transport === "sse" ? "sse" : "poll";
  }
  start() {
    this.active = true;
    this.load();
    this.restart();
    const listener = GM_addValueChangeListener(
      KEY,
      (_key, _old, _new, remote) => {
        if (remote) {
          this.enrollment?.abort();
          this.load();
          this.rows.clear();
          this.restart();
        }
      },
    );
    return () => {
      this.active = false;
      this.cancel();
      this.enrollment?.abort();
      GM_removeValueChangeListener(listener);
      this.rows.clear();
      this.phase = "off";
      this.notice = "";
      this.emit();
    };
  }
  private cancel() {
    ++this.generation;
    clearTimeout(this.timer);
    this.controller.abort();
    this.controller = new AbortController();
    this.closeStream?.();
    this.closeStream = undefined;
  }
  restart() {
    this.cancel();
    this.failures = 0;
    this.phase = !this.active ? "off" : this.device ? "connecting" : "setup";
    this.emit();
    if (this.active && this.device) this.connect();
  }
  private connect() {
    const device = this.device;
    if (!this.active || !device) return;
    const generation = this.generation;
    logger.log("connecting", { transport: this.transport });
    if (this.transport === "sse") {
      this.closeStream = stream(
        device.token,
        (event, data) => {
          if (generation !== this.generation) return;
          if (event === "unauthorized") {
            this.failed(new ApiError(401, null));
            return;
          }
          if (event === "snapshot") {
            this.rows = snapshot(data);
            logger.log("SSE snapshot applied", { records: this.rows.size });
            if (this.failures > 0) this.notice = "";
            this.phase = "connected";
            this.failures = 0;
            this.emit();
          } else if (event === "update" && this.phase === "connected") {
            const row = data as Row;
            if (!validShipmentId(row.shipmentId))
              throw new Error("Invalid shipment ID");
            const next = status(row);
            if (next.revision > (this.rows.get(row.shipmentId)?.revision ?? 0))
              this.rows.set(row.shipmentId, next);
            this.emit();
          }
        },
        (error) => {
          if (generation === this.generation) this.failed(error);
        },
      );
    } else {
      void this.poll(generation);
    }
  }
  private async poll(generation: number) {
    try {
      const value = await request(
        "GET",
        "/v1/paperwork",
        this.device!.token,
        undefined,
        this.controller.signal,
      );
      if (generation !== this.generation) return;
      this.rows = snapshot(value);
      logger.log("poll snapshot applied", { records: this.rows.size });
      if (this.failures > 0) this.notice = "";
      this.phase = "connected";
      this.failures = 0;
      this.emit();
      this.timer = setTimeout(() => {
        void this.poll(generation);
      }, 2500);
      logger.log("next poll scheduled", { delayMs: 2500 });
    } catch (error) {
      if (generation === this.generation) this.failed(error);
    }
  }
  private failed(error: unknown) {
    this.cancel();
    const unauthorized = error instanceof ApiError && error.status === 401;
    this.phase = unauthorized ? "unauthorized" : "disconnected";
    this.notice =
      error instanceof Error ? error.message : "Paperwork sync failed.";
    this.emit();
    logger.warn("connection failed", {
      transport: this.transport,
      unauthorized,
    });
    if (!unauthorized && this.active && this.device) {
      const delay =
        Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5)) *
        (0.8 + Math.random() * 0.4);
      logger.log("reconnect scheduled", {
        transport: this.transport,
        delayMs: Math.round(delay),
      });
      this.timer = setTimeout(() => {
        this.phase = "connecting";
        this.emit();
        this.connect();
      }, delay);
    }
  }
  async save(id: string, received: boolean) {
    if (this.phase !== "connected" || !this.device || !validShipmentId(id))
      return;
    const revision = this.rows.get(id)?.revision ?? 0;
    //* Pause reads while writing; a fresh snapshot resolves ambiguous acknowledgments.
    this.cancel();
    const generation = this.generation;
    this.phase = "saving";
    this.notice = "";
    this.emit();
    try {
      await request(
        "PUT",
        `/v1/paperwork/${encodeURIComponent(id)}`,
        this.device.token,
        { received, expectedRevision: revision },
        this.controller.signal,
      );
      if (generation === this.generation) this.restart();
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ApiError && error.status === 409) {
        this.notice =
          "Shipment changed on another workstation. Showing the latest server state.";
        this.restart();
      } else this.failed(error);
    }
  }
  async enroll(code: string, label: string, transport: "poll" | "sse") {
    this.enrollment?.abort();
    const controller = new AbortController();
    this.enrollment = controller;
    try {
      const result = (await request(
        "POST",
        "/v1/enroll",
        undefined,
        { code, label },
        controller.signal,
      )) as { token: string; deviceId: string };
      if (controller.signal.aborted || !this.active) return;
      if (
        !/^[a-f0-9]{64}$/.test(result.token) ||
        typeof result.deviceId !== "string"
      )
        throw new Error("Invalid enrollment response");
      GM_setValue(KEY, {
        apiUrl: API_URL,
        token: result.token,
        deviceId: result.deviceId,
        transport,
      });
      this.load();
      this.notice = "";
      this.restart();
    } finally {
      if (this.enrollment === controller) this.enrollment = undefined;
    }
  }
  forget() {
    this.enrollment?.abort();
    this.cancel();
    GM_deleteValue(KEY);
    this.device = undefined;
    this.configured = false;
    this.rows.clear();
    this.notice = "";
    this.restart();
  }
  setTransport(transport: "poll" | "sse") {
    if (!this.device) return;
    GM_setValue(KEY, { ...this.device, transport });
    this.load();
    this.restart();
  }
}
export const paperwork = new PaperworkState();
