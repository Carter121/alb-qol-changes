import type { Tweak } from "../types";
import { createLogger, injectHostCss, onElement } from "../helpers";

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
    let striped: Element | null = null;
    const cancelWatch = onElement(".grid-table tbody", (el) => {
      el.classList.add(className);
      striped = el;
      log("striping applied");
    });
    return () => {
      cancelWatch();
      striped?.classList.remove(className);
      removeCss();
    };
  },
};
