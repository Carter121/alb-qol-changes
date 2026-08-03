import type { Tweak } from "./types";
import { checkInNotifications } from "./pinc/check-in-notifications";
import { tableStriping } from "./pinc/table-striping";

//* Separate from sites.ts so vite.config's import graph stays browser-free.
const allTweaks: Tweak[] = [checkInNotifications, tableStriping];

export function tweaksFor(siteId: string, url: URL): Tweak[] {
  return allTweaks.filter(
    (tweak) =>
      tweak.siteId === siteId &&
      (!tweak.pathPattern || tweak.pathPattern.test(url.pathname)),
  );
}
