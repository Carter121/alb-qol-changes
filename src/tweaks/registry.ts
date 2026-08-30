import type { Tweak } from "./types";
import { arrivalFilterWarning } from "./pinc/arrival-filter-warning";
import { checkInNotifications } from "./pinc/check-in-notifications";
import { keepAwake } from "./pinc/keep-awake";
import { newCheckInRows } from "./pinc/new-check-in-rows";
import { tableStriping } from "./pinc/table-striping";

//* Separate from sites.ts so vite.config's import graph stays browser-free.
const allTweaks: Tweak[] = [
  checkInNotifications,
  keepAwake,
  newCheckInRows,
  tableStriping,
  arrivalFilterWarning,
];

export function tweaksFor(siteId: string, url: URL): Tweak[] {
  return allTweaks.filter(
    (tweak) =>
      tweak.siteId === siteId &&
      (!tweak.pathPattern || tweak.pathPattern.test(url.pathname)),
  );
}
