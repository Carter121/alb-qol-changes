import type { CleanupFn, Tweak } from "../types";
import { attachColumnTitles } from "./column-titles";
import { attachDriverPhone } from "./driver-phone";
import { attachPreferredLocations } from "./preferred-locations";
import { attachTableStriping } from "./table-striping";

export const betterTable: Tweak = {
  id: "better-table",
  siteId: "pinc",
  title: "Better Table",
  description:
    "Add row striping, format driver phone numbers, shorten preferred locations, and simplify column titles.",
  pathPattern: /^\/shipments/,
  apply() {
    const cleanups: CleanupFn[] = [];
    const cleanup = () => {
      for (const stop of cleanups.splice(0).reverse()) stop();
    };
    try {
      cleanups.push(attachTableStriping());
      if (/^\/shipments\/?$/.test(location.pathname)) {
        cleanups.push(attachPreferredLocations());
        cleanups.push(attachDriverPhone());
      }
      cleanups.push(attachColumnTitles());
      return cleanup;
    } catch (cause) {
      cleanup();
      throw cause;
    }
  },
};
