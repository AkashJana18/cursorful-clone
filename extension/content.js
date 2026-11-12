/* Click capture for the recorded tab.
   Buffers pointerdown positions and flushes them to the service worker. */

(() => {
  if (window.__cfCompanionInstalled) {
    return;
  }
  window.__cfCompanionInstalled = true;

  const MAX_BUFFER = 4000;
  const FLUSH_MS = 600;

  let sessionId = null;
  let buffer = [];
  let timer = 0;

  const onPointerDown = (event) => {
    if (!sessionId || event.button !== 0) return;
    buffer.push({
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
      t: Date.now(),
      w: window.innerWidth,
      h: window.innerHeight,
    });
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
  };

  const flush = () => {
    if (!sessionId || buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    try {
      chrome.runtime.sendMessage({
        type: "clicks",
        sessionId,
        clicks: batch,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
    } catch {
      /* extension context can be reloaded mid-session */
    }
  };

  const start = (id) => {
    sessionId = id;
    buffer = [];
    window.clearInterval(timer);
    timer = window.setInterval(flush, FLUSH_MS);
    document.addEventListener("pointerdown", onPointerDown, true);
  };

  const stop = () => {
    flush();
    window.clearInterval(timer);
    timer = 0;
    document.removeEventListener("pointerdown", onPointerDown, true);
    sessionId = null;
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "start") {
      start(message.sessionId);
      sendResponse({ ok: true });
    } else if (message.type === "stop") {
      stop();
      sendResponse({ ok: true });
    } else if (message.type === "ping") {
      sendResponse({ ok: true, active: Boolean(sessionId) });
    }
  });
})();
