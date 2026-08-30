import { mount } from "svelte";
import css from "./app.css?inline";
import App from "./App.svelte";
import { DEBUG, injectHostCss } from "./tweaks/helpers";
import { TweakManager } from "./tweaks/manager.svelte";
import { tweaksFor } from "./tweaks/registry";
import { findActiveSite } from "./tweaks/sites";

//* Defense in depth: @match already restricts where the script runs.
const site = findActiveSite(location.href);
if (!site) {
  console.warn("[alb-qol] no site matches", location.href);
} else {
  if (DEBUG) {
    injectHostCss(`
      #alb-qol-debug-banner {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        z-index: 2147483647 !important;
        background: #c00 !important;
        color: #fff !important;
        font: bold 14px/1 sans-serif !important;
        text-align: center !important;
        padding: 6px 0 !important;
        pointer-events: none !important;
      }
    `);
    const banner = document.createElement("div");
    banner.id = "alb-qol-debug-banner";
    banner.textContent = "alb-qol DEBUG MODE";
    document.body.append(banner);
    //* Same squeeze trick as the sidebar: push the page down so the fixed
    //* banner occupies its own space instead of covering the top of the site.
    document.documentElement.style.marginTop = `${banner.offsetHeight}px`;
  }

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
