export const requests = [];
export const storage = new Map();
export const listeners = new Map();
export const GM_getValue = (key, fallback) => storage.get(key) ?? fallback;
export const GM_setValue = (key, value) => storage.set(key, value);
export const GM_deleteValue = (key) => storage.delete(key);
export function GM_addValueChangeListener(key, callback) {
  listeners.set(key, callback);
  return key;
}
export const GM_removeValueChangeListener = (id) => listeners.delete(id);
export function GM_xmlhttpRequest(options) {
  const item = {
    ...options,
    aborted: false,
    respond(status, body) {
      options.onload({ status, responseText: JSON.stringify(body) });
    },
    openStream(status = 200) {
      let controller;
      const encoder = new TextEncoder();
      const response = new ReadableStream({
        start(value) {
          controller = value;
        },
        cancel() {
          item.readerCanceled = true;
        },
      });
      options.onloadstart({ status, response, finalUrl: options.url });
      return {
        push: (text) => controller.enqueue(encoder.encode(text)),
        bytes: (bytes) => controller.enqueue(bytes),
        close: () => {
          controller.close();
          options.onload({ status });
        },
        error: () => controller.error(new Error("Synthetic read failure")),
      };
    },
  };
  requests.push(item);
  return {
    abort() {
      item.aborted = true;
      options.onabort?.();
    },
  };
}
