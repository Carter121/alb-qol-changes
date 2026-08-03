# Architecture

How the userscript is put together, and why some of it looks unusual. The target site (Kaleris YMS, locally replicated at `127.0.0.1:8730`) is actively hostile to injected UI, and most of the odd choices below exist to survive it.

## Build pipeline

- **Vite + vite-plugin-monkey** bundle `src/main.ts` and everything it imports into a single userscript at `dist/alb-qol-changes.user.js`.
- The `@match` header lines are derived from `src/tweaks/sites.ts` (imported by `vite.config.ts`), so the site registry is the single source of truth for where the script runs.
- `@grant` lines are auto-detected: importing `GM_getValue` etc. from `vite-plugin-monkey/dist/client` is enough, no manual header edits.
- Userscript metadata (name, version, description, author) comes from `package.json`.
- `pnpm dev` serves a live-reload install page for Tampermonkey; `pnpm build` produces the installable file; `pnpm check` runs svelte-check and tsc.

## The hostile host page

Three properties of the YMS page shape everything else:

1. **A universal reset**: its stylesheet contains an unlayered `* { background: transparent !important; color: black !important; box-shadow: none !important }`. This beats any specificity and even inline styles. Separately, all of Tailwind's output lives in `@layer` blocks, and unlayered page CSS always wins over layered CSS.
2. **CSP blocks `<style>` tags** (style-src). Constructed stylesheets via `adoptedStyleSheets` are exempt, so that is the only reliable way to inject CSS, both for our UI and for tweaks.
3. **Root font-size is 12px.** Anything sized in rem (all of Tailwind) renders at 75% because rem always resolves against the document root, even inside a shadow root.

## UI mounting (`src/main.ts`)

- The app mounts inside an **open shadow root** on `div#alb-qol-root`. Host page selectors cannot cross the shadow boundary, which neutralizes the reset and the layer problem in both directions (our Tailwind preflight also stays out of the page).
- The host div gets `position: relative; z-index: 2147483647` so the fixed UI inside stacks above everything on the page.
- `app.css` is imported with `?inline`, has every rem converted to px at 16px/rem (see hostile property 3), and is attached via `adoptedStyleSheets`.
- **@property re-adoption**: Chrome ignores `@property` rules in shadow-adopted stylesheets, which silently breaks Tailwind utilities built on registered custom properties (transforms, rings, shadows; the visible symptom was the switch thumb not sliding). `main.ts` extracts those rules and re-adopts them at the document level, where registrations are global and therefore apply inside the shadow tree.

## Sidebar UI

- shadcn-svelte components (zinc base, "vega" style) with the `Sidebar` component, `side="left"`, collapsible offcanvas. Chosen over `Sheet` because the desktop sidebar renders in place (no portal escaping the shadow root) and is non-modal, so the page stays usable while it is open.
- The provider wrapper is collapsed to `min-h-0 w-0` so it adds no layout space to the host page; everything visible is `position: fixed`.
- `src/lib/components/sidebar-tab.svelte` is the trapezoid pull tab, rendered inside `Sidebar.Root` so it slides with the drawer. Ctrl/Cmd+B also toggles.
- The panel is scoped dark (`class="dark"` on `Sidebar.Root`) for contrast against the white page; the rest of the app stays light themed. The dark `--sidebar-*` palette in `app.css` is tuned slate navy to echo the YMS navbar.
- Caveat: below 768px the Sidebar component switches to a Sheet that portals to `document.body`, outside the shadow root, where it would render unstyled. Fine for a desktop-only app; redirect the portal inside the shadow root if narrow windows ever matter.

## Tweak engine

See [creating-tweaks.md](./creating-tweaks.md) for the how-to. The moving parts:

| File                                     | Role                                                           |
| ---------------------------------------- | -------------------------------------------------------------- |
| `src/tweaks/sites.ts`                    | Site registry (node-safe; also feeds `@match`)                 |
| `src/tweaks/types.ts`                    | `Tweak` and `CleanupFn` interfaces                             |
| `src/tweaks/registry.ts`                 | Flat list of all tweaks + `tweaksFor(siteId, url)` filter      |
| `src/tweaks/manager.svelte.ts`           | Enabled state, persistence, cross-tab sync, live apply/cleanup |
| `src/tweaks/helpers.ts`                  | `injectHostCss`, `onElement`, `createLogger`                   |
| `src/lib/components/tweaks-group.svelte` | Switch rows in the sidebar                                     |

Startup flow in `main.ts`: `findActiveSite(location.href)` gates everything (no site, no UI, no tweaks), then `TweakManager` gets the tweaks for the current site and URL, `manager.start()` applies the enabled ones, and the manager is passed to `App.svelte` as a prop.

### State, persistence, and cross-tab sync

Each tweak's enabled flag lives in GM storage under `tweak-enabled:<id>`, defaulting to **on**. A toggle flows like this:

```
Switch onCheckedChange
  -> manager.setEnabled(id, value)
       -> enabled[id] = value        ($state, UI updates)
       -> GM_setValue(key, value)    (persists + notifies other tabs)
       -> #setRunning(tweak, value)  (live apply or cleanup)
Other tabs: GM_addValueChangeListener fires with remote === true
  -> update enabled[id] and #setRunning there too
Same-tab listener echo (remote === false) is ignored.
```

`#setRunning` uses a generation counter: every toggle bumps it, and an async `apply()` that finishes after a newer toggle has its cleanup run immediately instead of being stored. One tweak throwing is caught and logged and never affects the others.
