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
      .alb-qol-paperwork-column { width: 90px; text-align: center !important; font-size: 12px; }
      .alb-qol-paperwork-column input { width: 16px; height: 16px; cursor: pointer; appearance: auto !important; }
      .alb-qol-paperwork-column input:disabled { cursor: not-allowed; opacity: 0.6; }
      .alb-qol-paperwork-column[aria-busy="true"] { background: #fff4e0 !important; }
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
