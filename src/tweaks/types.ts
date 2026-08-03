import type { SiteId } from "./sites";

export type CleanupFn = () => void;

export interface Tweak {
  //* Unique kebab-case id, also the storage key suffix.
  id: string;
  siteId: SiteId;
  title: string;
  description?: string;
  //* Tested against location.pathname once at load (no SPA re-evaluation).
  pathPattern?: RegExp;
  //* Return a cleanup that fully undoes the tweak, or void if not undoable.
  apply: () => CleanupFn | void | Promise<CleanupFn | void>;
}
