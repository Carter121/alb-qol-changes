# alb-qol-changes

A Tampermonkey userscript with quality-of-life tweaks for the PINC/Kaleris YMS shipments page, built with Svelte 5, Tailwind v4, and shadcn-svelte, bundled by vite-plugin-monkey.

A collapsible sidebar (pull tab on the left edge, or Ctrl/Cmd+B) hosts per-site tweak toggles. Tweaks apply live, persist, and sync across open tabs.

## Commands

| Command       | What it does                                                |
| ------------- | ----------------------------------------------------------- |
| `pnpm dev`    | Dev server with a live-reload install page for Tampermonkey |
| `pnpm build`  | Build `dist/alb-qol-changes.user.js`                        |
| `pnpm check`  | svelte-check + tsc                                          |
| `pnpm format` | Prettier                                                    |

## Docs

- [Architecture](docs/architecture.md): how the build, shadow-root UI, and tweak engine fit together, and the host-page quirks that shaped them
- [Creating tweaks](docs/creating-tweaks.md): how to add a tweak or a new site
