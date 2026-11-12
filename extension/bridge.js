/* Relay between the studio page and the service worker.
   Injected into studio tabs by the background worker, so the page never
   needs to know the extension id. */

(() => {
  if (window.__cursorfulBridge) return;
  window.__cursorfulBridge = true;

  const send = (message) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch {
        resolve(null);
      }
    });

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.__cursorful !== "req") return;

    send({ type: "bridge", action: data.action, payload: data.payload }).then((response) => {
      window.postMessage({ __cursorful: "res", id: data.id, response }, "*");
    });
  });

  window.postMessage({ __cursorful: "ready" }, "*");
})();
