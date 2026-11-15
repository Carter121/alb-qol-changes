import { createLogger } from "../helpers";
import type { CleanupFn } from "../types";

export const INJECTED_COLUMN = "data-alb-qol-column";
export type TablePhase = "rows" | "columns" | "text" | "decoration";
export type ShipmentColumn = {
  header: HTMLTableCellElement;
  field: string | null;
};
export type ShipmentSort = { index: number; field: string; ascending: boolean };
export type ShipmentTable = {
  table: HTMLTableElement;
  header: HTMLTableRowElement;
  columns: ShipmentColumn[];
  sort: ShipmentSort | null;
};
type Consumer = {
  name: string;
  phase: TablePhase;
  update: (tables: ShipmentTable[]) => void;
  cleanup?: CleanupFn;
};
const phases: TablePhase[] = ["rows", "columns", "text", "decoration"];
const coordinators = new WeakMap<Document, Coordinator>();
const { error } = createLogger("shipments-table");

export function siteCells(row: HTMLTableRowElement) {
  return Array.from(row.cells).filter(
    (cell) => !cell.hasAttribute(INJECTED_COLUMN),
  );
}

function linkField(header: HTMLTableCellElement): string | null {
  const link = header.querySelector<HTMLAnchorElement>("a[href*='sort_key=']");
  if (!link) return null;
  try {
    return (
      new URL(
        link.getAttribute("href")!,
        header.ownerDocument.baseURI,
      ).searchParams.get("sort_key") || null
    );
  } catch {
    return null;
  }
}

function readTables(doc: Document): ShipmentTable[] {
  return Array.from(
    doc.querySelectorAll<HTMLTableElement>("table.grid-table"),
  ).flatMap((table) => {
    const header = table.tHead?.rows[0];
    if (!header) return [];
    const columns = siteCells(header).map((cell) => ({
      header: cell,
      field: linkField(cell),
    }));
    const index = columns.findIndex((column) =>
      column.header.classList.contains("active_sort_tag"),
    );
    const active = columns[index];
    //* The sort link toggles direction; the image describes current order.
    const image =
      active?.header.querySelector("img")?.getAttribute("src") ?? "";
    const ascending = image.includes("sort_asc")
      ? true
      : image.includes("sort_desc")
        ? false
        : null;
    const sort =
      active?.field && ascending !== null
        ? { index, field: active.field, ascending }
        : null;
    return [{ table, header, columns, sort }];
  });
}

export function getShipmentsView(): string | null {
  const param = new URLSearchParams(location.search).get("view_type");
  if (param) return param;
  const link = document.querySelector<HTMLAnchorElement>(
    "#shipment-tabs dd.active a",
  );
  try {
    return link
      ? new URL(link.getAttribute("href")!, document.baseURI).searchParams.get(
          "view_type",
        )
      : null;
  } catch {
    return null;
  }
}

function relevant(record: MutationRecord) {
  const element =
    record.target.nodeType === 1
      ? (record.target as Element)
      : record.target.parentElement;
  const selector = "table.grid-table, #shipment-tabs";
  if (element?.closest(selector)) return true;
  if (
    record.type === "attributes" &&
    record.attributeName === "class" &&
    element?.tagName === "TABLE" &&
    record.oldValue?.split(/\s+/).includes("grid-table")
  )
    return true;
  return [...record.addedNodes, ...record.removedNodes].some(
    (node) =>
      node.nodeType === 1 &&
      ((node as Element).matches(selector) ||
        (node as Element).querySelector(selector)),
  );
}

class Coordinator {
  consumers = new Set<Consumer>();
  private running = false;
  private observer: MutationObserver;

  constructor(private doc: Document) {
    const Observer = doc.defaultView!.MutationObserver;
    this.observer = new Observer((records) => {
      if (records.some(relevant)) this.refresh();
    });
  }

  private watch() {
    if (this.running || !this.consumers.size) return;
    this.observer.observe(this.doc.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: [
        "href",
        "class",
        "src",
        "data-alb-qol-shipment-id",
        INJECTED_COLUMN,
        "colspan",
        "rowspan",
      ],
    });
  }

  refresh = () => {
    if (this.running || !this.consumers.size) return;
    this.running = true;
    //* All consumers share one paused observer during owned DOM writes.
    this.observer.disconnect();
    try {
      const ordered = [...this.consumers].sort(
        (a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase),
      );
      for (const consumer of ordered) {
        if (!this.consumers.has(consumer)) continue;
        try {
          consumer.update(readTables(this.doc));
        } catch (cause) {
          error(`Update failed for ${consumer.name}`, cause);
        }
      }
    } finally {
      this.running = false;
      this.watch();
    }
  };

  remove(consumer: Consumer) {
    if (!this.consumers.delete(consumer)) return;
    this.observer.disconnect();
    try {
      consumer.cleanup?.();
    } catch (cause) {
      error(`Cleanup failed for ${consumer.name}`, cause);
    } finally {
      this.refresh();
      this.watch();
    }
  }
}

export function subscribeToShipmentTables(consumer: Consumer) {
  let coordinator = coordinators.get(document);
  if (!coordinator) {
    coordinator = new Coordinator(document);
    coordinators.set(document, coordinator);
  }
  const shared = coordinator;
  shared.consumers.add(consumer);
  shared.refresh();
  return {
    refresh: () => {
      if (shared.consumers.has(consumer)) shared.refresh();
    },
    cleanup: () => shared.remove(consumer),
  };
}

export function createTextEdits() {
  const changes = new Map<Text, { original: string; replacement: string }>();
  return {
    prune() {
      for (const node of changes.keys())
        if (!node.isConnected) changes.delete(node);
    },
    owns(element: Element) {
      return Array.from(changes.keys()).some((node) => element.contains(node));
    },
    replace(element: Element, transform: (value: string) => string) {
      const walker = element.ownerDocument.createTreeWalker(element, 4);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const original = node.data;
        const replacement = transform(original);
        if (replacement === original) continue;
        const previous = changes.get(node);
        changes.set(node, {
          original:
            previous?.replacement === original ? previous.original : original,
          replacement,
        });
        node.data = replacement;
      }
    },
    cleanup() {
      for (const [node, { original, replacement }] of changes) {
        if (node.data === replacement) node.data = original;
      }
      changes.clear();
    },
  };
}
