import { GM_notification } from "vite-plugin-monkey/dist/client";
import type { Tweak } from "../types";
import { createLogger } from "../helpers";

const REFRESH_INTERVAL = 60_000;
//* Origin-relative so it works on the local replica and production
const SHIPMENTS_URL = "/shipments.json?view_type=arrivals";

type Shipment = { shipment_id?: string | number };

export const checkInNotifications: Tweak = {
  id: "check-in-notifications",
  siteId: "pinc",
  title: "Check-in notifications",
  description: "Desktop notification when a new arrival checks in.",
  pathPattern: /^\/shipments/,
  async apply() {
    const { log, warn, error } = createLogger("check-in");

    if (typeof GM_notification !== "function") {
      error("GM_notification is not available; notifications will not appear.");
    }
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      void Notification.requestPermission();
    }

    //* Seed with current shipments so existing check-ins don't notify
    const notified = new Set<Shipment["shipment_id"]>();
    const initial = await getShipments("initial load");
    initial.forEach((s) => notified.add(s.shipment_id));
    log(`seeded ${notified.size} existing shipment(s)`);
    if (initial.length === 0) {
      warn(
        "Initial load returned zero shipments; if arrivals is not empty, the fetch is failing.",
      );
    }

    let pollCount = 0;
    const intervalId = setInterval(async () => {
      const cycle = ++pollCount;
      const all = await getShipments(`poll #${cycle}`);
      const fresh = all.filter((s) => !notified.has(s.shipment_id));
      log(`poll #${cycle}: ${all.length} shipment(s), ${fresh.length} new`);
      if (fresh.length > 0) notify(fresh.length);
      fresh.forEach((s) => notified.add(s.shipment_id));
    }, REFRESH_INTERVAL);

    //* Re-enabling reseeds from the current arrivals list
    return () => {
      clearInterval(intervalId);
      log("stopped");
    };

    //* Always resolves to an array so a transient failure skips a cycle instead
    //* of killing the interval. A non-JSON body means a logged-out session.
    async function getShipments(context: string): Promise<Shipment[]> {
      try {
        const res = await fetch(SHIPMENTS_URL);
        if (!res.ok) {
          error(
            `fetch (${context}) failed with HTTP ${res.status}. Are you still logged in?`,
          );
          return [];
        }
        const body = await res.text();
        let data: unknown;
        try {
          data = JSON.parse(body);
        } catch {
          error(
            `fetch (${context}) returned non-JSON; you are probably logged out.`,
            {
              bodyPreview: body.slice(0, 200),
            },
          );
          return [];
        }
        if (!Array.isArray(data)) {
          error(`fetch (${context}) returned JSON that is not an array.`, data);
          return [];
        }
        const missingIds = data.filter(
          (s: Shipment) => s?.shipment_id === undefined,
        ).length;
        if (missingIds > 0) {
          warn(
            `${missingIds} of ${data.length} shipment(s) have no shipment_id.`,
          );
        }
        return data as Shipment[];
      } catch (fetchError) {
        error(`fetch (${context}) threw`, fetchError);
        return [];
      }
    }

    function notify(count: number) {
      const text =
        count === 1 ? "1 person checked in!" : `${count} people checked in!`;
      try {
        GM_notification({
          title: "Check In Alert",
          text,
          timeout: 5000,
          onclick: () => window.focus(),
        });
      } catch (notifyError) {
        error("GM_notification threw", notifyError);
      }
    }
  },
};
