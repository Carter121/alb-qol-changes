import { createLogger } from "../helpers";
import type { Status } from "./paperwork-model";
import { validShipmentId } from "./paperwork-model";

export const PAPERWORK_COLUMN = "alb-qol-paperwork-column";
export function isArrivalsView() {
  const param = new URLSearchParams(location.search).get("view_type");
  if (param) return param === "arrivals";
  const active = document.querySelector<HTMLAnchorElement>(
    "#shipment-tabs dd.active a",
  );
  return (
    !!active &&
    new URL(active.href, location.href).searchParams.get("view_type") ===
      "arrivals"
  );
}
export type TableState = { phase: string; rows: Map<string, Status> };
export function attachPaperworkTable(
  getState: () => TableState,
  save: (id: string, received: boolean) => void,
) {
  const { warn } = createLogger("paperwork");
  const warned = new WeakSet<HTMLTableRowElement>();
  const owned = new Set<Element>();
  const observer = new MutationObserver(refresh);
  const watch = () =>
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "href", "data-alb-qol-shipment-id"],
    });
  function refresh() {
    //* Disconnect during owned DOM writes to avoid observing ourselves.
    observer.disconnect();
    for (const element of owned)
      if (!element.isConnected) owned.delete(element);
    if (!isArrivalsView()) {
      for (const element of owned) element.remove();
      owned.clear();
      watch();
      return;
    }
    for (const table of document.querySelectorAll<HTMLTableElement>(
      "table.grid-table",
    )) {
      const header = table.tHead?.rows[0];
      if (!header) continue;
      if (!header.querySelector(`.${PAPERWORK_COLUMN}`)) {
        const th = document.createElement("th");
        th.className = PAPERWORK_COLUMN;
        th.textContent = "Paperwork";
        th.scope = "col";
        header.append(th);
        owned.add(th);
      }
      const index = Array.from(header.cells).findIndex((th) => {
        const link = th.querySelector<HTMLAnchorElement>(
          "a[href*='sort_key=']",
        );
        return (
          !!link &&
          new URL(link.href, location.href).searchParams.get("sort_key") ===
            "shipment_id"
        );
      });
      for (const body of table.tBodies)
        for (const row of body.rows) {
          if (row.cells.length === 1 && row.cells[0].colSpan > 1) continue;
          let cell = row.querySelector<HTMLTableCellElement>(
            `:scope > .${PAPERWORK_COLUMN}`,
          );
          if (!cell) {
            cell = document.createElement("td");
            cell.className = PAPERWORK_COLUMN;
            row.append(cell);
            owned.add(cell);
          }
          const id =
            row.dataset.albQolShipmentId ??
            (index >= 0 ? row.cells[index]?.textContent?.trim() : undefined);
          if (!id || !validShipmentId(id)) {
            cell.textContent = "Unavailable";
            if (!warned.has(row)) {
              warned.add(row);
              warn(
                "Cannot identify shipment for a paperwork control; row disabled.",
              );
            }
            continue;
          }
          let input = cell.querySelector("input");
          if (!input) {
            input = document.createElement("input");
            input.type = "checkbox";
            cell.replaceChildren(input);
          }
          const state = getState();
          input.setAttribute(
            "aria-label",
            `Paperwork received for shipment ${id}`,
          );
          input.checked = state.rows.get(id)?.received ?? false;
          input.disabled = state.phase !== "connected";
          input.indeterminate = state.phase !== "connected";
          input.title =
            state.phase === "connected"
              ? "Checked means physical paperwork is at the guard shack."
              : `Paperwork status unavailable: ${state.phase}. Open ALB QOL for sync details.`;
          cell.setAttribute("aria-busy", String(state.phase === "saving"));
          input.onchange = () => {
            save(id, input!.checked);
            refresh();
          };
          input.onclick = (event) => event.stopPropagation();
        }
    }
    watch();
  }
  refresh();
  return {
    refresh,
    cleanup() {
      observer.disconnect();
      for (const element of owned) element.remove();
      owned.clear();
    },
  };
}
