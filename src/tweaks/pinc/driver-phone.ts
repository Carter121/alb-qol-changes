import { attachShipmentCellText } from "./shipments-table";

function formatPhone(value: string): string {
  const match = /^(\s*)(\+1)?(\d{3})(\d{3})(\d{4})(\s*)$/.exec(value);
  if (!match) return value;
  const [, leading, countryCode, area, exchange, line, trailing] = match;
  const prefix = countryCode ? `${countryCode} ` : "";
  return `${leading}${prefix}(${area}) ${exchange}-${line}${trailing}`;
}

export function attachDriverPhone() {
  return attachShipmentCellText(
    "driver-phone",
    ({ field }) => field === "custom_text17",
    formatPhone,
  );
}
