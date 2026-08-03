# Creating Tweaks

A tweak is a small, self-contained fix scoped to one site, toggleable from the sidebar, persisted, and synced across tabs. Adding one is three steps.

## 1. Write the tweak module

Create `src/tweaks/<siteId>/<tweak-name>.ts`:

```ts
import type { Tweak } from "../types";
import { createLogger, injectHostCss, onElement } from "../helpers";

export const myTweak: Tweak = {
  id: "my-tweak", //* unique, kebab-case; also the storage key suffix
  siteId: "pinc", //* must exist in sites.ts
  title: "My tweak", //* switch label in the sidebar
  description: "One line shown under the title.",
  pathPattern: /^\/shipments/, //* optional; omit to run on every matched page
  apply() {
    const { log } = createLogger("my-tweak");
    const removeCss = injectHostCss(`
      .alb-qol-my-tweak { outline: 2px solid red !important; }
    `);
    let target: Element | null = null;
    const cancelWatch = onElement(".some-selector", (el) => {
      el.classList.add("alb-qol-my-tweak");
      target = el;
      log("applied");
    });
    return () => {
      cancelWatch();
      target?.classList.remove("alb-qol-my-tweak");
      removeCss();
    };
  },
};
```

## 2. Register it

Add it to `allTweaks` in `src/tweaks/registry.ts`. That is the only wiring; the sidebar row, persistence, and cross-tab sync come from the manager.

## 3. Verify

`pnpm check`, then `pnpm build` and reinstall `dist/alb-qol-changes.user.js` (or use `pnpm dev`). Toggle the tweak on and off in the sidebar and confirm it fully undoes itself. Open a second tab and confirm the toggle syncs.

## Rules that keep tweaks working on this site

- **Never inject `<style>` elements into the host page.** The site's CSP blocks them. `injectHostCss` uses `adoptedStyleSheets`, which is exempt, and returns a remover.
- **Expect to need `!important`** for background, color, box-shadow, and text-shadow. The site has a universal `* { ... !important }` reset that wins otherwise.
- **Size in px, not rem**, in host-page CSS. The site's root font is 12px, so 1rem is 12px there.
- **Don't `querySelector` once and give up.** The page renders parts of itself late. `onElement(selector, cb)` fires immediately if the element exists, otherwise via MutationObserver; its cancel function is part of your cleanup. Pass `{ timeoutMs }` if waiting forever would be wrong.
- **Prefix injected class names with `alb-qol-`** so they can never collide with site classes.
- **Return a cleanup that undoes everything**: cancel watchers, remove classes, remove CSS, clear intervals. Returning nothing is allowed but means toggling off only takes effect on the next page load.
- **`apply` may be async** (see `check-in-notifications.ts`, which seeds from a fetch before starting its interval). The manager's generation counter handles the user toggling mid-flight, but your cleanup must still undo whatever the async work set up.
- **Log through `createLogger(scope)`.** Routine logs are gated behind the `DEBUG` const in `helpers.ts`; warnings and errors always print.

## Per-tweak behavior you get for free

- Sidebar switch row (only rendered on the tweak's site, and only when `pathPattern` matches).
- Enabled state persisted in GM storage as `tweak-enabled:<id>`, **default on** for fresh installs.
- Live apply/remove without reload, in the current tab and every other open tab on the same site.
- Crash isolation: a throwing tweak is logged and cannot break the others.

## Adding a new site

1. Add an entry to `sites` in `src/tweaks/sites.ts`:

```ts
{
  id: "example",
  name: "Example",
  matches: ["https://example.com/*"],
}
```

2. Create `src/tweaks/example/` for its tweaks and register them as above.
3. `pnpm build`. The new `@match` lines are emitted automatically; reinstall the userscript so Tampermonkey picks up the new header.

Patterns are literal prefixes with `*` wildcards only (see `urlMatchesPattern`). Keep `sites.ts` free of browser and svelte imports; `vite.config.ts` imports it at build time in node.

## GM APIs

Import what you need from `vite-plugin-monkey/dist/client` (`GM_notification`, `GM_getValue`, ...). The matching `@grant` header lines are added automatically at build. Note that calling `window.focus()` also needs a grant; the plugin detects that too.
