import type { Tweak } from "./types";
import { checkInNotifications } from "./pinc/check-in-notifications";
import { keepAwake } from "./pinc/keep-awake";
import { newCheckInRows } from "./pinc/new-check-in-rows";
import { paperworkStatus } from "./pinc/paperwork-status";
import { betterTable } from "./pinc/better-table";

//* Separate from sites.ts so vite.config's import graph stays browser-free.
const allTweaks: Tweak[] = [
  checkInNotifications,
  keepAwake,
  newCheckInRows,
  betterTable,
  paperworkStatus,
];

export function tweaksFor(siteId: string, url: URL): Tweak[] {
  return allTweaks.filter(
    (tweak) =>
      tweak.siteId === siteId &&
      (!tweak.pathPattern || tweak.pathPattern.test(url.pathname)),
  );
}
