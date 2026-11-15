import { subscribeToShipmentTables } from "./shipments-table";
import type { Tweak } from "../types";
import { createLogger, injectHostCss } from "../helpers";

export const tableStriping: Tweak = {
  id: "table-striping",
  siteId: "pinc",
  title: "Table striping",
  description: "Zebra-stripe the shipments table so rows are easier to scan.",
  pathPattern: /^\/shipments/,
  apply() {
    const { log } = createLogger("table-striping");
    const className = "alb-qol-table-striping";
    //* !important beats the site's universal reset
    const removeCss = injectHostCss(`
      tbody.${className} {
        background-color: #ffffff;
      }
      tbody.${className} tr:nth-child(even) {
        background-color: #e0e0e0 !important;
      }
    `);
    const striped = new Set<HTMLTableSectionElement>();
    const subscription = subscribeToShipmentTables({
      name: "table-striping",
      phase: "decoration",
      update(tables) {
        const bodies = new Set(
          tables.flatMap(({ table }) => Array.from(table.tBodies)),
        );
        for (const body of striped) {
          if (!bodies.has(body)) {
            body.classList.remove(className);
            striped.delete(body);
          }
        }
        for (const body of bodies) {
          body.classList.add(className);
          striped.add(body);
        }
      },
      cleanup() {
        for (const body of striped) body.classList.remove(className);
        striped.clear();
        removeCss();
        log("stopped");
      },
    });
    return subscription.cleanup;
  },
};
