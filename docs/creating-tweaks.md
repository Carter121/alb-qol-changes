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

## PINC shipments table tweaks

Use `subscribeToShipmentTables` from `src/tweaks/pinc/shipments-table.ts` instead of creating another observer or using `onElement` for the shipments table. It shares one observer per document and handles delayed rendering and table replacement.

```ts
const edits = createTextEdits();
const subscription = subscribeToShipmentTables({
  name: "my-table-tweak",
  phase: "text",
  update(tables) {
    edits.prune();
    for (const { columns } of tables) {
      const column = columns.find((column) => column.field === "shipment_id");
      if (column)
        edits.replace(column.header, (text) => text.replace("Shipment", "ID"));
    }
  },
  cleanup: edits.cleanup,
});
return subscription.cleanup;
```

Consumers run synchronously in phase order: `rows`, `columns`, `text`, then `decoration`. Registration order breaks ties. Contexts are rebuilt before each consumer, so later phases see earlier structural edits. Updates must be idempotent; do not subscribe or request another refresh from an update. Calls to `refresh()` during dispatch are suppressed. Outside dispatch, `refresh()` updates all consumers immediately, including pending DOM changes.

Each context contains `table`, `header`, native `columns` (`header` and nullable `field`), and nullable `sort` (`index`, `field`, `ascending`). The index refers to native columns, not physical cell positions. Use `siteCells(row)` to obtain matching native cells. Skip rows with mismatched cell counts or merged cells. Mark every injected header and body cell with the exported `INJECTED_COLUMN` attribute (`data-alb-qol-column`) so other consumers exclude it. Keep feature styling and data fetching in the tweak.

`createTextEdits()` preserves descendants and event handlers. Call `prune()` each update to release detached text nodes. Its cleanup restores only text still matching its own replacement. `owns(element)` recognizes a previously renamed header when it has no sort link.

Put owned DOM/CSS cleanup in the subscription's `cleanup` callback, where observation is paused. Stop external subscriptions before calling the returned cleanup. Cleanup is idempotent; individual consumer errors are logged and do not stop later phases. The last unsubscribe disconnects the observer. `getShipmentsView()` reads the URL view first, then the active tab, and returns `null` if unknown. Page path matching remains the tweak manager's responsibility.

### Regression and release checks

`pnpm test` runs all Node/jsdom test files using the existing userscript mocks. The shipments suite covers all 8 feature combinations, all 6 enable orders and reverse cleanup, a reproducible 500-operation lifecycle sequence, and a 1,000-row mutation burst. It also checks sort order, native cell mapping, table replacement, unknown paperwork state, reversible text, shared observer quiescence, exception isolation, and persisted/remote toggles. Each fixture fails on unexpected consumer errors. No browser test dependency is required.

Before distributing an update, require `pnpm test`, `pnpm check`, and `pnpm build` to pass. The deployment workflow runs these checks before publishing. These tests cannot validate real PINC markup, CSP, computed colors, or Tampermonkey behavior. On a workstation with access, verify sorting links, checkbox writes and propagation, highlighting, replacement tables, all three table switches, and two-tab toggle synchronization. Keep the previous installable userscript and version available for rollback. Validate on one workstation before broader distribution; stop rollout for misaligned columns, duplicate rows or controls, observer loops, or incorrect paperwork state.

### Better Table and column titles

Better Table combines row striping, preferred-location ranges, and column-title replacements under one switch. New check-in rows and paperwork sync remain independent. The new `tweak-enabled:better-table` preference defaults on, even if either retired feature was disabled. Legacy striping and preferred-location keys remain stored but are ignored. Once the combined switch has a saved preference, it persists and syncs normally across tabs.

Edit `columnTitles` in `src/tweaks/pinc/column-titles.ts` to add a title without changing the handler:

```ts
{ field: "purchase_order_number", from: "Purchase Order Number", to: "PO Number" }
```

`field` is the column's sort key. `from` identifies its original label; matching ignores case and repeated whitespace. Headers with no usable sort key can match the source label, but a different known field cannot. Customized and already-shortened labels stay unchanged. The handler preserves nested markup, links, icons, and event handlers, and restores owned edits when Better Table is disabled. The PO rule applies across shipments tabs. Preferred-location cell formatting retains its existing scope: the inbound preferred-location field on the shipments list. Striping retains its shipments-route scope. No individual feature options or title-editing UI are added.
