import type { Tweak } from "../types";
import { createLogger } from "../helpers";

export const keepAwake: Tweak = {
  id: "keep-awake",
  siteId: "pinc",
  title: "Keep computer awake",
  description: "Stops the computer from going to sleep while this tab is open.",
  apply() {
    const { log, warn, error } = createLogger("keep-awake");

    if (!("wakeLock" in navigator)) {
      warn("Screen Wake Lock API not supported in this browser.");
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;

    async function acquire() {
      try {
        sentinel = await navigator.wakeLock.request("screen");
        log("wake lock acquired");
        //* The browser auto-releases when the tab is hidden; reacquire on return.
        sentinel.addEventListener("release", () => {
          log("wake lock released");
          sentinel = null;
        });
      } catch (requestError) {
        error("wake lock request failed", requestError);
      }
    }

    function onVisibilityChange() {
      if (
        !stopped &&
        sentinel === null &&
        document.visibilityState === "visible"
      ) {
        void acquire();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    void acquire();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release();
      sentinel = null;
    };
  },
};
