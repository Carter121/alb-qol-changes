import type { Tweak } from "../types";
import { injectHostCss } from "../helpers";
import { attachPaperworkTable } from "./paperwork-table";
import { paperwork } from "./paperwork-state.svelte";

export const paperworkStatus: Tweak = {
  id: "paperwork-status",
  siteId: "pinc",
  title: "Paperwork sync",
  description: "Share whether physical paperwork is at the guard shack.",
  pathPattern: /^\/shipments\/?$/,
  apply() {
    const stop = paperwork.start();
    const removeCss = injectHostCss(`
      .alb-qol-paperwork-column { width: 1% !important; white-space: nowrap !important; text-align: center !important; font-size: 12px; }
      table.grid-table th.alb-qol-paperwork-column { padding: 0 4px !important; font-size: 10px !important; line-height: 12px !important; }
      table.grid-table td.alb-qol-paperwork-column { padding: 0 4px !important; vertical-align: middle !important; line-height: 16px !important; }
      .alb-qol-paperwork-column input { width: 16px !important; height: 16px !important; min-width: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; box-sizing: border-box !important; vertical-align: middle !important; cursor: pointer; appearance: auto !important; }
      .alb-qol-paperwork-column input:disabled { cursor: not-allowed; opacity: 0.6; }
      .alb-qol-paperwork-column[aria-busy="true"] { background: #fff4e0 !important; }
      .alb-qol-paperwork-column th { color: #21608a !important; }
    `);
    const table = attachPaperworkTable(
      () => ({ phase: paperwork.phase, rows: paperwork.rows }),
      (id, received) => {
        void paperwork.save(id, received);
      },
    );
    const unsubscribe = paperwork.subscribe(table.refresh);
    return () => {
      unsubscribe();
      table.cleanup();
      stop();
      removeCss();
    };
  },
};
