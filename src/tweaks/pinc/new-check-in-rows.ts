import {
  siteCells,
  subscribeToShipmentTables,
  type ShipmentTable,
} from "./shipments-table";
import type { Tweak } from "../types";
import { createLogger, injectHostCss } from "../helpers";
import { subscribeToNewShipments, type Shipment } from "./shipments-poller";

const ROW_CLASS = "alb-qol-new-row";

//* Each th maps to its JSON field via the sort link's sort_key param;
//* null covers the actions column and any future unlinked column.
type Column = { field: string | null };

export const newCheckInRows: Tweak = {
  id: "new-check-in-rows",
  siteId: "pinc",
  title: "New check-in rows",
  description:
    "Insert newly checked-in arrivals into the table with a red highlight, no reload needed.",
  pathPattern: /^\/shipments/,
  apply() {
    const { log, warn } = createLogger("new-rows");

    //* The td rule outranks the site's universal reset; the tr rule outranks
    //* the striping tweak's nth-child rule.
    const removeCss = injectHostCss(`
      table.grid-table tbody tr.${ROW_CLASS},
      table.grid-table tbody tr.${ROW_CLASS} > td {
        background-color: #f4cccc !important;
      }
    `);

    const pending = new Map<string, Shipment>();
    let serverOrder: readonly Shipment[] = [];
    const injected: HTMLTableRowElement[] = [];

    const subscription = subscribeToShipmentTables({
      name: "new-check-in-rows",
      phase: "rows",
      update(tables) {
        for (let index = injected.length - 1; index >= 0; index--) {
          if (!injected[index].isConnected) injected.splice(index, 1);
        }
        const context = tables.find(
          ({ table, columns }) => table.tBodies[0] && columns.length > 0,
        );
        if (context) flush(context);
      },
      cleanup() {
        injected.forEach((tr) => tr.remove());
        injected.length = 0;
        pending.clear();
        serverOrder = [];
        removeCss();
      },
    });
    const unsubscribe = subscribeToNewShipments((fresh, all) => {
      for (const shipment of fresh) {
        if (shipment.shipment_id === undefined) {
          warn("shipment has no shipment_id; skipping row", shipment);
          continue;
        }
        const id = String(shipment.shipment_id);
        if (!pending.has(id)) pending.set(id, shipment);
      }
      if (pending.size === 0) return;
      serverOrder = all;
      subscription.refresh();
    });

    return () => {
      unsubscribe();
      subscription.cleanup();
      log("stopped");
    };

    function flush({ table, columns }: ShipmentTable) {
      if (pending.size === 0) return;
      const tbody = table.tBodies[0];
      const rowsById = readRowsById(tbody, columns);

      //* Walk backward so each matching row anchors the shipments before it.
      let before: HTMLTableRowElement | null = null;
      for (let index = serverOrder.length - 1; index >= 0; index--) {
        const shipment = serverOrder[index];
        if (shipment.shipment_id === undefined) continue;
        const id = String(shipment.shipment_id);
        const queued = pending.get(id);
        pending.delete(id);
        const existing = rowsById.get(id);
        if (existing) {
          before = existing;
        } else if (queued) {
          before = insertShipment(queued, id, tbody, columns, before);
        }
      }

      //* An older queued shipment may be absent from the latest snapshot.
      for (const [id, shipment] of pending) {
        if (!rowsById.has(id))
          insertShipment(shipment, id, tbody, columns, null);
      }
      pending.clear();
      serverOrder = [];
    }

    function insertShipment(
      shipment: Shipment,
      id: string,
      tbody: HTMLTableSectionElement,
      columns: Column[],
      before: HTMLTableRowElement | null,
    ) {
      const tr = buildRow(shipment, columns, id);
      injected.push(tr);
      tbody.insertBefore(tr, before);
      log(`inserted row for shipment ${id}`);
      return tr;
    }

    function readRowsById(tbody: HTMLTableSectionElement, columns: Column[]) {
      const idIndex = columns.findIndex((c) => c.field === "shipment_id");
      const rows = new Map<string, HTMLTableRowElement>();
      for (const row of tbody.rows) {
        const injectedId = row.dataset.albQolShipmentId;
        if (injectedId !== undefined) {
          rows.set(injectedId, row);
          continue;
        }
        if (idIndex === -1) continue;
        const cells = siteCells(row);
        if (
          cells.length !== columns.length ||
          cells.some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)
        )
          continue;
        const id = cells[idIndex].textContent?.trim();
        if (id !== undefined) rows.set(id, row);
      }
      return rows;
    }

    function buildRow(
      shipment: Shipment,
      columns: Column[],
      id: string,
    ): HTMLTableRowElement {
      const tr = document.createElement("tr");
      tr.classList.add(ROW_CLASS);
      tr.dataset.albQolShipmentId = id;
      for (const column of columns) {
        const td = document.createElement("td");
        //* Actions and other unlinked columns stay blank; full actions
        //* come back on the next natural reload
        if (column.field !== null) {
          const text = coerce(getByPath(shipment, column.field), column.field);
          if (column.field === "shipment_id" && shipment.unique_id) {
            const a = document.createElement("a");
            const backTo = encodeURIComponent("/shipments?view_type=arrivals");
            a.href = `/shipments/edit?back_to=${backTo}&shipment_unique_id=${encodeURIComponent(shipment.unique_id)}&view_type=inbound`;
            a.textContent = text;
            td.appendChild(a);
          } else {
            td.textContent = text;
          }
        }
        tr.appendChild(td);
      }
      return tr;
    }

    function coerce(value: unknown, field: string): string {
      if (value === null || value === undefined) return "";
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      warn(
        `field "${field}" holds a non-scalar value; rendering it blank`,
        value,
      );
      return "";
    }

    function getByPath(shipment: Shipment, path: string): unknown {
      return path
        .split(".")
        .reduce<unknown>(
          (obj, key) =>
            obj !== null && typeof obj === "object"
              ? (obj as Record<string, unknown>)[key]
              : undefined,
          shipment,
        );
    }
  },
};
