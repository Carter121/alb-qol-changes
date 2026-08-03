//* Single source of truth for site definitions. vite.config.ts imports this
//* for the @match lines, so keep it node-safe.

export interface Site {
  id: string;
  name: string;
  matches: readonly string[];
}

export const sites = [
  {
    id: "pinc",
    name: "PINC YMS",
    matches: [
      "http://127.0.0.1:8730/shipments*",
      "https://abs-slc.pincsolutions.com/shipments*",
    ],
  },
] as const satisfies readonly Site[];

export type SiteId = (typeof sites)[number]["id"];

//* Not full @match semantics: patterns are literal prefixes with "*" wildcards.
export function urlMatchesPattern(pattern: string, url: string): boolean {
  const regex = new RegExp(
    `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? ".*" : `\\${ch}`))}$`,
  );
  return regex.test(url);
}

export function findActiveSite(url: string): Site | undefined {
  return sites.find((site) =>
    site.matches.some((pattern) => urlMatchesPattern(pattern, url)),
  );
}
