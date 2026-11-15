import { createTextEdits, subscribeToShipmentTables } from "./shipments-table";

export type ColumnTitleRule = { field: string; from: string; to: string };
export const columnTitles: readonly ColumnTitleRule[] = [
  {
    field: "purchase_order_number",
    from: "Purchase Order Number",
    to: "PO Number",
  },
];
const normalize = (text: string) =>
  text.replace(/\s+/g, " ").trim().toLowerCase();

export function attachColumnTitles(
  rules: readonly ColumnTitleRule[] = columnTitles,
) {
  const edits = createTextEdits();
  const subscription = subscribeToShipmentTables({
    name: "column-titles",
    phase: "text",
    update(tables) {
      edits.prune();
      for (const { columns } of tables) {
        for (const { header, field } of columns) {
          const rule = rules.find(
            (rule) =>
              (field === rule.field || field === null) &&
              normalize(header.textContent ?? "") === normalize(rule.from),
          );
          if (!rule) continue;
          //* Distribute the label over its text nodes without replacing markup.
          let first = true;
          edits.replace(header, (text) => {
            if (!text.trim()) return text;
            const result = first
              ? `${text.match(/^\s*/)?.[0] ?? ""}${rule.to}${text.match(/\s*$/)?.[0] ?? ""}`
              : "";
            first = false;
            return result;
          });
        }
      }
    },
    cleanup: edits.cleanup,
  });
  return subscription.cleanup;
}
