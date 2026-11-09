# alb-qol-changes

A Tampermonkey userscript with quality-of-life tweaks for the PINC/Kaleris YMS shipments page, built with Svelte 5, Tailwind v4, and shadcn-svelte, bundled by vite-plugin-monkey.

A collapsible sidebar (pull tab on the left edge, or Ctrl/Cmd+B) hosts per-site tweak toggles. Tweaks apply live, persist, and sync across open tabs.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. [Click here to install the userscript](https://carter121.github.io/alb-qol-changes/alb-qol-changes.user.js).

The script updates automatically via Tampermonkey when a new version is published.

## Commands

| Command       | What it does                                                |
| ------------- | ----------------------------------------------------------- |
| `pnpm dev`    | Dev server with a live-reload install page for Tampermonkey |
| `pnpm build`  | Build `dist/alb-qol-changes.user.js`                        |
| `pnpm test`   | Paperwork sync state, transport, and table tests (Node 24+) |
| `pnpm check`  | svelte-check + tsc                                          |
| `pnpm format` | Prettier                                                    |

## Docs

- [Paperwork sync](docs/paperwork-sync.md): server setup, enrollment, transport options, and browser acceptance checks

- [Architecture](docs/architecture.md): how the build, shadow-root UI, and tweak engine fit together, and the host-page quirks that shaped them
- [Creating tweaks](docs/creating-tweaks.md): how to add a tweak or a new site
