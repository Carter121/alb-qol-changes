import {
  GM_addValueChangeListener,
  GM_getValue,
  GM_setValue,
} from "vite-plugin-monkey/dist/client";
import { createLogger } from "./helpers";
import type { CleanupFn, Tweak } from "./types";

const storageKey = (id: string) => `tweak-enabled:${id}`;

type TweakRuntime = {
  //* Guards rapid on/off/on races while an async apply() is in flight.
  generation: number;
  cleanup: CleanupFn | null;
};

export class TweakManager {
  readonly tweaks: Tweak[];
  //* Reflects stored intent, not runtime success.
  enabled = $state<Record<string, boolean>>({});
  #runtimes = new Map<string, TweakRuntime>();
  #log = createLogger("manager");

  constructor(tweaks: Tweak[]) {
    this.tweaks = tweaks;
    for (const tweak of tweaks) {
      this.#runtimes.set(tweak.id, { generation: 0, cleanup: null });
    }
  }

  start(): void {
    for (const tweak of this.tweaks) {
      this.enabled[tweak.id] = GM_getValue(storageKey(tweak.id), true);
      if (this.enabled[tweak.id]) void this.#setRunning(tweak, true);

      GM_addValueChangeListener<boolean>(
        storageKey(tweak.id),
        (_name, _old, newValue, remote) => {
          //* Local writes are already handled in setEnabled.
          if (!remote) return;
          const value = newValue ?? true;
          this.enabled[tweak.id] = value;
          void this.#setRunning(tweak, value);
        },
      );
    }
  }

  setEnabled(id: string, value: boolean): void {
    const tweak = this.tweaks.find((t) => t.id === id);
    if (!tweak) return;
    this.enabled[id] = value;
    GM_setValue(storageKey(id), value);
    void this.#setRunning(tweak, value);
  }

  async #setRunning(tweak: Tweak, run: boolean): Promise<void> {
    const runtime = this.#runtimes.get(tweak.id)!;
    const generation = ++runtime.generation;

    if (runtime.cleanup) {
      try {
        runtime.cleanup();
      } catch (error) {
        this.#log.error(`cleanup of "${tweak.id}" threw`, error);
      }
      runtime.cleanup = null;
    }
    if (!run) return;

    try {
      const cleanup = (await tweak.apply()) ?? null;
      //* A newer toggle happened during the await: undo immediately.
      if (runtime.generation !== generation) {
        try {
          cleanup?.();
        } catch (error) {
          this.#log.error(`stale cleanup of "${tweak.id}" threw`, error);
        }
        return;
      }
      runtime.cleanup = cleanup;
    } catch (error) {
      this.#log.error(`apply of "${tweak.id}" threw`, error);
    }
  }
}
