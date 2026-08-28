import type { CleanupFn } from "../types";
import { createLogger } from "../helpers";

const REFRESH_INTERVAL = 30_000;
//* Origin-relative so it works on the local replica and production.
//* The server scopes results to the user's session filters/tab on its own.
const SHIPMENTS_URL = "/shipments.json?view_type=arrivals";

export type Shipment = {
  shipment_id?: string | number;
  unique_id?: string;
  [key: string]: unknown;
};

type FreshHandler = (fresh: Shipment[]) => void;

const { log, warn, error } = createLogger("shipments-poller");

const subscribers = new Set<FreshHandler>();
let seen: Set<Shipment["shipment_id"]> | null = null;
let intervalId: ReturnType<typeof setInterval> | undefined;
//* Bumped on every start/stop so stale async continuations bail out
let generation = 0;
let pollCount = 0;

//* Shared refcounted poller: starts on first subscriber, one fetch per
//* interval regardless of subscriber count, stops and resets on last
//* unsubscribe. Subscribers only receive shipments that appear after the
//* poller's seed, never the backlog.
export function subscribeToNewShipments(onFresh: FreshHandler): CleanupFn {
  subscribers.add(onFresh);
  if (subscribers.size === 1) void seedAndStart(++generation);

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    subscribers.delete(onFresh);
    if (subscribers.size > 0) return;
    clearInterval(intervalId);
    intervalId = undefined;
    seen = null;
    pollCount = 0;
    generation++;
    log("stopped");
  };
}

//* Seed with current shipments so existing check-ins never count as fresh
async function seedAndStart(gen: number) {
  const initial = await getShipments("initial load");
  if (gen !== generation) return;
  seen = new Set(initial.map((s) => s.shipment_id));
  log(`seeded ${seen.size} existing shipment(s)`);
  if (initial.length === 0) {
    warn(
      "Initial load returned zero shipments; if arrivals is not empty, the fetch is failing.",
    );
  }

  intervalId = setInterval(async () => {
    const cycle = ++pollCount;
    const all = await getShipments(`poll #${cycle}`);
    if (gen !== generation || !seen) return;
    const seenSet = seen;
    const fresh = all.filter((s) => !seenSet.has(s.shipment_id));
    log(`poll #${cycle}: ${all.length} shipment(s), ${fresh.length} new`);
    fresh.forEach((s) => seenSet.add(s.shipment_id));
    if (fresh.length === 0) return;
    //* One throwing subscriber must not starve the others
    subscribers.forEach((handler) => {
      try {
        handler(fresh);
      } catch (handlerError) {
        error("subscriber threw", handlerError);
      }
    });
  }, REFRESH_INTERVAL);
}

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
      warn(`${missingIds} of ${data.length} shipment(s) have no shipment_id.`);
    }
    return data as Shipment[];
  } catch (fetchError) {
    error(`fetch (${context}) threw`, fetchError);
    return [];
  }
}
