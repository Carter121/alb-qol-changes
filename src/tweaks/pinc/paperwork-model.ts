export type Status = { received: boolean; revision: number; updatedAt: number };
export type Row = Status & { shipmentId: string };
export type Snapshot = { shipments: Record<string, Status> };
export const validShipmentId = (id: string) =>
  typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);

export function status(value: unknown): Status {
  const row = value as Status;
  if (
    !row ||
    typeof row.received !== "boolean" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    !Number.isSafeInteger(row.updatedAt)
  )
    throw new Error("Invalid server response");
  return {
    received: row.received,
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

export function snapshot(value: unknown): Map<string, Status> {
  const rows = (value as Snapshot)?.shipments;
  if (!rows || typeof rows !== "object" || Array.isArray(rows))
    throw new Error("Invalid server snapshot");
  return new Map(
    Object.entries(rows).map(([id, row]) => {
      if (!validShipmentId(id)) throw new Error("Invalid shipment ID");
      return [id, status(row)];
    }),
  );
}

//* SSE fields and frames can span arbitrary transport chunks.
export class EventFrames {
  private buffer = "";
  push(chunk: string): { event: string; data: string }[] {
    this.buffer += chunk;
    if (this.buffer.length > 2_000_000)
      throw new Error("Event buffer exceeded limit");
    const frames = [];
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        if (field === "data") data.push(value);
      }
      if (data.length) frames.push({ event, data: data.join("\n") });
    }
    return frames;
  }
}
