import type { Tweak } from "../types";

function condenseLocations(value: string): string {
  const departments = new Map<string, { min: number; max: number }>();
  for (const entry of value.split(",")) {
    const match = /^\s*([^:,]+):\s*(\d+)\s*$/.exec(entry);
    if (!match) return value;
    const department = match[1].trim();
    const door = Number(match[2]);
    if (!Number.isSafeInteger(door)) return value;
    const range = departments.get(department);
    departments.set(department, {
      min: Math.min(range?.min ?? door, door),
      max: Math.max(range?.max ?? door, door),
    });
  }
  return Array.from(
    departments,
    ([department, { min, max }]) => `${department}:${min}-${max}`,
  ).join(",");
}

export const preferredLocations: Tweak = {
  id: "preferred-locations",
  siteId: "pinc",
  title: "Preferred location ranges",
  description:
    "Shorten inbound preferred locations to a door range per department.",
  pathPattern: /^\/shipments\/?$/,
  apply() {
    const changes = new Map<Text, { original: string; replacement: string }>();
    const observer = new MutationObserver(refresh);

    function replaceText(
      element: Element,
      transform: (value: string) => string,
    ) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
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
    }

    function refresh() {
      observer.disconnect();
      for (const node of changes.keys()) {
        if (!node.isConnected) changes.delete(node);
      }
      for (const table of document.querySelectorAll<HTMLTableElement>(
        "table.grid-table",
      )) {
        const header = table.tHead?.rows[0];
        if (!header) continue;
        for (const th of header.cells) {
          const link = th.querySelector<HTMLAnchorElement>(
            "a[href*='sort_key=']",
          );
          const field = link
            ? new URL(link.href, location.href).searchParams.get("sort_key")
            : null;
          const isInbound =
            /^(?:integrations\.)?preferred_locations\.inbound$/i.test(
              field ?? "",
            );
          const wasRenamed = Array.from(changes.keys()).some((node) =>
            th.contains(node),
          );
          if (
            !isInbound &&
            !wasRenamed &&
            !/preferred\s*locations\s*\.\s*inbound/i.test(th.textContent ?? "")
          )
            continue;

          replaceText(th, (text) =>
            text.replace(
              /preferred\s*locations\s*\.\s*inbound/gi,
              "Preferred Locations",
            ),
          );
          for (const body of table.tBodies) {
            for (const row of body.rows) {
              if (row.cells.length !== header.cells.length) continue;
              const cell = row.cells[th.cellIndex];
              replaceText(cell, condenseLocations);
            }
          }
        }
      }
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["href"],
      });
    }

    refresh();
    return () => {
      observer.disconnect();
      for (const [node, { original, replacement }] of changes) {
        if (node.data === replacement) node.data = original;
      }
      changes.clear();
    };
  },
};
