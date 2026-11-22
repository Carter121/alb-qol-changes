import { attachShipmentCellText } from "./shipments-table";

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
  return attachShipmentCellText(
    "preferred-locations",
    ({ header, field }) =>
      /^(?:integrations\.)?preferred_locations\.inbound$/i.test(field ?? "") ||
      /^(?:preferred\s*locations)(?:\s*\.\s*inbound)?$/i.test(
        header.textContent?.trim() ?? "",
      ),
    condenseLocations,
  );
}
