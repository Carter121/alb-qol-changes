import {
  INJECTED_COLUMN,
  getShipmentsView,
  siteCells,
  subscribeToShipmentTables,
  type ShipmentTable,
} from "./shipments-table";
import { createLogger } from "../helpers";
import type { Status } from "./paperwork-model";
import { validShipmentId } from "./paperwork-model";

export const PAPERWORK_COLUMN = "alb-qol-paperwork-column";
export { siteCells } from "./shipments-table";
export function isArrivalsView() {
  return getShipmentsView() === "arrivals";
}
export type TableState = { phase: string; rows: Map<string, Status> };
export function attachPaperworkTable(
  getState: () => TableState,
  save: (id: string, received: boolean) => void,
) {
  const { warn } = createLogger("paperwork");
  const warned = new WeakSet<HTMLTableRowElement>();
  const owned = new Set<Element>();
  function update(tables: ShipmentTable[]) {
    for (const element of owned) {
      if (!tables.some(({ table }) => table.contains(element))) {
        element.remove();
        owned.delete(element);
      }
    }
    if (!isArrivalsView()) {
      for (const element of owned) element.remove();
      owned.clear();
      return;
    }
    for (const { table, header, columns } of tables) {
      if (!header.querySelector(`.${PAPERWORK_COLUMN}`)) {
        const th = document.createElement("th");
        th.className = PAPERWORK_COLUMN;
        th.setAttribute(INJECTED_COLUMN, "paperwork");
        th.textContent = "BOLs";
        th.scope = "col";
        header.insertBefore(th, header.cells[1] ?? null);
        owned.add(th);
      }
      const index = columns.findIndex(
        (column) => column.field === "shipment_id",
      );
      for (const body of table.tBodies)
        for (const row of body.rows) {
          const native = siteCells(row);
          if (
            native.length !== columns.length ||
            native.some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)
          ) {
            const previous = row.querySelector(`:scope > .${PAPERWORK_COLUMN}`);
            if (previous && owned.has(previous)) {
              previous.remove();
              owned.delete(previous);
            }
            continue;
          }
          let cell = row.querySelector<HTMLTableCellElement>(
            `:scope > .${PAPERWORK_COLUMN}`,
          );
          if (!cell) {
            cell = document.createElement("td");
            cell.className = PAPERWORK_COLUMN;
            cell.setAttribute(INJECTED_COLUMN, "paperwork");
            row.insertBefore(cell, row.cells[1] ?? null);
            owned.add(cell);
          }
          const id =
            row.dataset.albQolShipmentId ??
            (index >= 0
              ? siteCells(row)[index]?.textContent?.trim()
              : undefined);
          if (!id || !validShipmentId(id)) {
            cell.textContent = "Unavailable";
            if (!warned.has(row)) {
              warned.add(row);
              warn(
                "Cannot identify shipment for a paperwork control, row disabled.",
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
              ? "Checked means we have the paperwork"
              : `Paperwork status unavailable: ${state.phase}. Open sidebar for sync details.`;
          cell.setAttribute("aria-busy", String(state.phase === "saving"));
          input.onchange = () => {
            save(id, input!.checked);
            subscription.refresh();
          };
          input.onclick = (event) => event.stopPropagation();
        }
    }
  }
  const subscription = subscribeToShipmentTables({
    name: "paperwork",
    phase: "columns",
    update,
    cleanup() {
      for (const element of owned) element.remove();
      owned.clear();
    },
  });
  return subscription;
}
