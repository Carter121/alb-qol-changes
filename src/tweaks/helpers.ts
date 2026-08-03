import type { CleanupFn } from "./types";

const DEBUG = false;

//* log() is gated behind DEBUG, warn/error always print.
export function createLogger(scope: string) {
  const prefix = `[alb-qol:${scope}]`;
  return {
    log: (...args: unknown[]) => {
      if (DEBUG) console.log(prefix, ...args);
    },
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}

//* Injects host-page CSS. The site's CSP blocks <style> tags but
//* adoptedStyleSheets is exempt; tweak CSS usually needs !important.
export function injectHostCss(cssText: string): CleanupFn {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssText);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return () => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (s) => s !== sheet,
    );
  };
}

//* Calls onFound when the selector first matches, now or via MutationObserver.
export function onElement<T extends Element = Element>(
  selector: string,
  onFound: (el: T) => void,
  options: { root?: ParentNode & Node; timeoutMs?: number } = {},
): CleanupFn {
  const { root = document, timeoutMs } = options;

  const existing = root.querySelector<T>(selector);
  if (existing) {
    onFound(existing);
    return () => {};
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    const el = root.querySelector<T>(selector);
    if (!el) return;
    cancel();
    onFound(el);
  });
  const cancel = () => {
    observer.disconnect();
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  };

  observer.observe(root, { childList: true, subtree: true });
  if (timeoutMs !== undefined) {
    timeoutId = setTimeout(() => {
      cancel();
      createLogger("on-element").warn(
        `gave up waiting for "${selector}" after ${timeoutMs}ms`,
      );
    }, timeoutMs);
  }
  return cancel;
}
