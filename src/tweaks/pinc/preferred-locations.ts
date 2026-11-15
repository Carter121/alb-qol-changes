import {
  createTextEdits,
  siteCells,
  subscribeToShipmentTables,
} from "./shipments-table";

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

export function attachPreferredLocations() {
  const edits = createTextEdits();
  const subscription = subscribeToShipmentTables({
    name: "preferred-locations",
    phase: "text",
    update(tables) {
      edits.prune();
      for (const { table, columns } of tables) {
        for (const [index, { header, field }] of columns.entries()) {
          if (
            !/^(?:integrations\.)?preferred_locations\.inbound$/i.test(
              field ?? "",
            ) &&
            !/^(?:preferred\s*locations)(?:\s*\.\s*inbound)?$/i.test(
              header.textContent?.trim() ?? "",
            )
          )
            continue;
          for (const body of table.tBodies) {
            for (const row of body.rows) {
              const cells = siteCells(row);
              if (
                cells.length !== columns.length ||
                cells.some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)
              )
                continue;
              edits.replace(cells[index], condenseLocations);
            }
          }
        }
      }
    },
    cleanup: edits.cleanup,
  });
  return subscription.cleanup;
}
