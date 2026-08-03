import type { Tweak } from "../types";
import { createLogger, injectHostCss, onElement } from "../helpers";
import { subscribeToNewShipments, type Shipment } from "./shipments-poller";

const ROW_CLASS = "alb-qol-new-row";

//* Each th maps to its JSON field via the sort link's sort_key param;
//* null covers the actions column and any future unlinked column.
type Column = { field: string | null };
type SortState = { index: number; field: string; ascending: boolean };

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

    let table: HTMLTableElement | null = null;
    const pending: Shipment[] = [];
    const injected: HTMLTableRowElement[] = [];

    const cancelWatch = onElement<HTMLTableElement>(
      "table.grid-table",
      (el) => {
        table = el;
        flush();
      },
    );
    const unsubscribe = subscribeToNewShipments((fresh) => {
      pending.push(...fresh);
      flush();
    });

    return () => {
      unsubscribe();
      cancelWatch();
      injected.forEach((tr) => tr.remove());
      injected.length = 0;
      pending.length = 0;
      removeCss();
      log("stopped");
    };

    //* Retains pending shipments until the table is usable; re-reads the
    //* thead every time so column changes are picked up.
    function flush() {
      if (!table || pending.length === 0) return;
      const tbody = table.tBodies[0];
      if (!tbody) {
        warn("table has no tbody; retrying next poll");
        return;
      }
      const columns = readColumns(table);
      if (columns.length === 0) {
        warn("no columns found in thead; retrying next poll");
        return;
      }
      const sort = readSort(table, columns);
      if (!sort)
        warn("could not determine sort; appending new rows at the end");

      const batch = pending.splice(0);
      for (const shipment of batch) {
        insertShipment(shipment, tbody, columns, sort);
      }
    }

    function insertShipment(
      shipment: Shipment,
      tbody: HTMLTableSectionElement,
      columns: Column[],
      sort: SortState | null,
    ) {
      if (shipment.shipment_id === undefined) {
        warn("shipment has no shipment_id; skipping row", shipment);
        return;
      }
      const id = String(shipment.shipment_id);
      if (rowExists(tbody, columns, id)) {
        log(`row for shipment ${id} already present; skipping`);
        return;
      }

      const tr = buildRow(shipment, columns, id);
      injected.push(tr);
      tbody.insertBefore(tr, findInsertBeforeRow(shipment, tbody, sort));
      log(`inserted row for shipment ${id}`);
    }

    function rowExists(
      tbody: HTMLTableSectionElement,
      columns: Column[],
      id: string,
    ): boolean {
      if (
        tbody.querySelector(`tr[data-alb-qol-shipment-id="${CSS.escape(id)}"]`)
      ) {
        return true;
      }
      const idIndex = columns.findIndex((c) => c.field === "shipment_id");
      if (idIndex === -1) return false;
      return Array.from(tbody.rows).some(
        (row) => row.cells[idIndex]?.textContent?.trim() === id,
      );
    }

    //* Returns the row to insert before, or null to append
    function findInsertBeforeRow(
      shipment: Shipment,
      tbody: HTMLTableSectionElement,
      sort: SortState | null,
    ): HTMLTableRowElement | null {
      if (!sort) return null;
      const value = getByPath(shipment, sort.field);
      if (value === undefined) {
        warn(
          `sort field "${sort.field}" missing from shipment JSON; appending`,
        );
        return null;
      }
      const newKey = coerce(value, sort.field);
      //* Empty values sort last in both directions
      if (newKey === "") return null;
      for (const row of Array.from(tbody.rows)) {
        const rowKey = row.cells[sort.index]?.textContent?.trim() ?? "";
        if (rowKey === "") return row;
        const cmp = compareKeys(rowKey, newKey);
        if (sort.ascending ? cmp > 0 : cmp < 0) return row;
      }
      return null;
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

    function readColumns(table: HTMLTableElement): Column[] {
      return Array.from(
        table.querySelectorAll<HTMLTableCellElement>("thead th"),
      ).map((th) => {
        const link = th.querySelector<HTMLAnchorElement>(
          "a[href*='sort_key=']",
        );
        if (!link) return { field: null };
        try {
          return { field: new URL(link.href).searchParams.get("sort_key") };
        } catch {
          return { field: null };
        }
      });
    }

    //* The active th's link holds the toggle direction, so the current
    //* direction must come from the sort arrow image instead
    function readSort(
      table: HTMLTableElement,
      columns: Column[],
    ): SortState | null {
      const headers = Array.from(
        table.querySelectorAll<HTMLTableCellElement>("thead th"),
      );
      const index = headers.findIndex((th) =>
        th.classList.contains("active_sort_tag"),
      );
      if (index === -1) return null;
      const field = columns[index]?.field;
      if (!field) return null;
      const imgSrc = headers[index].querySelector("img")?.src ?? "";
      if (imgSrc.includes("sort_asc")) return { index, field, ascending: true };
      if (imgSrc.includes("sort_desc"))
        return { index, field, ascending: false };
      return null;
    }

    //* Coercion is shared by rendering and comparison so they agree
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

    function compareKeys(a: string, b: string): number {
      const numeric = /^-?\d+(\.\d+)?$/;
      if (numeric.test(a) && numeric.test(b)) return Number(a) - Number(b);
      return a < b ? -1 : a > b ? 1 : 0;
    }
  },
};
