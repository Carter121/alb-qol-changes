import { mount } from "svelte";
import css from "./app.css?inline";
import App from "./App.svelte";
import { TweakManager } from "./tweaks/manager.svelte";
import { tweaksFor } from "./tweaks/registry";
import { findActiveSite } from "./tweaks/sites";

//* Defense in depth: @match already restricts where the script runs.
const site = findActiveSite(location.href);
if (!site) {
  console.warn("[alb-qol] no site matches", location.href);
} else {
  //* Start tweaks before the UI so they apply even if the sidebar never opens.
  const manager = new TweakManager(tweaksFor(site.id, new URL(location.href)));
  manager.start();

  //* Shadow root keeps the host page's hostile CSS out and our preflight in.
  const host = document.createElement("div");
  host.id = "alb-qol-root";
  host.style.position = "relative";
  host.style.zIndex = "2147483647";
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });

  //* Host root font is 12px and rem always resolves against it, so convert to px.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(
    css.replace(
      /(\d*\.?\d+)rem\b/g,
      (_, n: string) => `${parseFloat(n) * 16}px`,
    ),
  );
  shadow.adoptedStyleSheets = [sheet];

  //* Chrome ignores @property in shadow-adopted sheets; re-adopt those rules at
  //* the document level so Tailwind's transform/ring vars resolve.
  const propertyRules = [...sheet.cssRules]
    .filter((rule): rule is CSSPropertyRule => rule instanceof CSSPropertyRule)
    .map((rule) => rule.cssText)
    .join("\n");
  if (propertyRules) {
    const propertySheet = new CSSStyleSheet();
    propertySheet.replaceSync(propertyRules);
    document.adoptedStyleSheets = [
      ...document.adoptedStyleSheets,
      propertySheet,
    ];
  }

  const target = document.createElement("div");
  shadow.append(target);

  mount(App, { target, props: { manager } });
}
