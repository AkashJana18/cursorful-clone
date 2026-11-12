/* Studio side of the click companion.
   The background worker injects a small bridge into this tab, so the page
   never needs to know the extension id. Every request is a postMessage with
   a timeout so a missing companion degrades to "no clicks" instead of a hang. */

export function createCompanion({ onReady } = {}) {
  const pending = new Map();
  let seq = 0;
  let connected = false;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.__cursorful === "res") {
      const resolve = pending.get(data.id);
      if (resolve) {
        pending.delete(data.id);
        resolve(data.response);
      }
      return;
    }

    if (data.__cursorful === "ready") {
      connected = true;
      if (onReady) onReady();
    }
  });

  function send(action, payload = null, timeout = 2500) {
    return new Promise((resolve) => {
      const id = `req_${++seq}`;
      pending.set(id, resolve);
      window.postMessage({ __cursorful: "req", id, action, payload }, "*");
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve(null);
        }
      }, timeout);
    });
  }

  async function ping() {
    const res = await send("ping", null, 900);
    connected = Boolean(res && res.ok);
    return connected;
  }

  return {
    send,
    ping,
    get connected() {
      return connected;
    },
  };
}
