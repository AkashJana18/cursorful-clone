/* Click companion service worker.
   Buffers clicks per capture session and hands them to the studio on request. */

const KEY = "captures";
const MAX_CLICKS = 6000;

async function readAll() {
  try {
    const stored = await chrome.storage.session.get(KEY);
    return stored[KEY] || {};
  } catch {
    return {};
  }
}

async function writeAll(all) {
  try {
    await chrome.storage.session.set({ [KEY]: all });
  } catch {
    /* session storage can be unavailable in rare profiles */
  }
}

function newSessionId() {
  return `cap_${Math.random().toString(36).slice(2, 10)}`;
}

function studioUrl(sessionId, base) {
  const url = new URL(base || "http://127.0.0.1:8899/studio/");
  url.searchParams.set("session", sessionId);
  url.searchParams.set("ext", chrome.runtime.id);
  return url.toString();
}

async function findStudioTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => {
    if (!tab.url) return false;
    return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/studio\//.test(tab.url);
  });
}

async function openStudio(sessionId) {
  const existing = await findStudioTab();
  if (existing) {
    const base = new URL(existing.url);
    base.search = "";
    const url = studioUrl(sessionId, `${base.origin}${base.pathname}`);
    await chrome.tabs.update(existing.id, { url, active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return existing.id;
  }
  const created = await chrome.tabs.create({ url: studioUrl(sessionId) });
  return created.id;
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  const sessionId = newSessionId();

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    await chrome.tabs.sendMessage(tab.id, { type: "start", sessionId });
  } catch (err) {
    console.warn("Cursorful companion: cannot attach to this tab", err);
    return;
  }

  const all = await readAll();
  all[sessionId] = {
    tabId: tab.id,
    title: tab.title || "",
    url: tab.url || "",
    clicks: [],
    viewport: null,
    startedAt: Date.now(),
  };
  await writeAll(all);

  try {
    await chrome.action.setBadgeText({ text: "REC", tabId: tab.id });
    await chrome.action.setBadgeBackgroundColor({ color: "#16a34a", tabId: tab.id });
  } catch {
    /* ignore */
  }

  await openStudio(sessionId);
});

async function findSessionForTab(tabId) {
  const all = await readAll();
  return Object.entries(all).find(([, s]) => s.tabId === tabId);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || !sender.tab) return;

  if (message.type === "clicks" && Array.isArray(message.clicks)) {
    void (async () => {
      const entry = await findSessionForTab(sender.tab.id);
      if (!entry) return;
      const [sessionId, session] = entry;
      const all = await readAll();
      if (!all[sessionId]) return;
      all[sessionId].clicks.push(...message.clicks);
      if (all[sessionId].clicks.length > MAX_CLICKS) {
        all[sessionId].clicks = all[sessionId].clicks.slice(-MAX_CLICKS);
      }
      if (message.viewport) all[sessionId].viewport = message.viewport;
      await writeAll(all);
    })();
  }
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  void (async () => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false });
      return;
    }

    if (message.type === "collect") {
      const all = await readAll();
      const session = all[message.session];
      if (!session) {
        sendResponse({ clicks: [], viewport: null, startedAt: 0 });
        return;
      }
      const payload = {
        clicks: session.clicks,
        viewport: session.viewport,
        startedAt: session.startedAt,
        title: session.title,
      };
      delete all[message.session];
      await writeAll(all);
      try {
        await chrome.tabs.sendMessage(session.tabId, { type: "stop" });
      } catch {
        /* tab may be gone */
      }
      try {
        await chrome.action.setBadgeText({ text: "", tabId: session.tabId });
      } catch {
        /* ignore */
      }
      sendResponse(payload);
      return;
    }

    if (message.type === "status") {
      const all = await readAll();
      const session = all[message.session];
      sendResponse({ clicks: session ? session.clicks.length : 0, active: Boolean(session) });
      return;
    }

    sendResponse({ ok: false });
  })();

  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: "" });
});
