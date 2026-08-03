import { GM_notification } from "vite-plugin-monkey/dist/client";
import type { Tweak } from "../types";
import { createLogger } from "../helpers";
import { subscribeToNewShipments } from "./shipments-poller";

export const checkInNotifications: Tweak = {
  id: "check-in-notifications",
  siteId: "pinc",
  title: "Check-in notifications",
  description: "Desktop notification when a new arrival checks in.",
  pathPattern: /^\/shipments/,
  apply() {
    const { log, error } = createLogger("check-in");

    if (typeof GM_notification !== "function") {
      error("GM_notification is not available; notifications will not appear.");
    }
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      void Notification.requestPermission();
    }

    const unsubscribe = subscribeToNewShipments((fresh) =>
      notify(fresh.length),
    );

    return () => {
      unsubscribe();
      log("stopped");
    };

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
