/* Click companion service worker.
   Buffers clicks per capture session, bridges the studio page, and hands the
   click log over on collect. */

const KEY = "cf_state";
const MAX_CLICKS = 8000;
const DEFAULT_STUDIO = "http://127.0.0.1:8899/studio/";
const STUDIO_MATCH = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/studio\//;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* All storage access is serialized so concurrent click batches cannot
   overwrite each other. */
let queue = Promise.resolve();
function serialized(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

async function readState() {
  try {
    const stored = await chrome.storage.session.get(KEY);
    const state = stored[KEY] || {};
    return { sessions: state.sessions || {}, active: state.active || null };
  } catch {
    return { sessions: {}, active: null };
  }
}

async function writeState(state) {
  try {
    await chrome.storage.session.set({ [KEY]: state });
  } catch {
    /* session storage can be unavailable in rare profiles */
  }
}

function newSessionId() {
  return `cap_${Math.random().toString(36).slice(2, 10)}`;
}

async function studioBase() {
  try {
    const { studioBase: saved } = await chrome.storage.local.get("studioBase");
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_STUDIO;
}

async function findStudioTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.url && STUDIO_MATCH.test(tab.url));
}

async function openStudio() {
  const existing = await findStudioTab();
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true }).catch(() => {});
    await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    return existing.id;
  }
  const created = await chrome.tabs.create({ url: await studioBase() });
  return created.id;
}

async function ensureBridge(tabId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    if (tab.status === "complete") break;
    await sleep(250);
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["bridge.js"] });
    return true;
  } catch (err) {
    console.warn("Cursorful companion: cannot attach the bridge", err);
    return false;
  }
}

async function setBadge(text, color, tabId) {
  try {
    await chrome.action.setBadgeText(tabId ? { text, tabId } : { text });
    if (color) {
      await chrome.action.setBadgeBackgroundColor(tabId ? { color, tabId } : { color });
    }
  } catch {
    /* ignore */
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  const sessionId = newSessionId();

  await serialized(async () => {
    const state = await readState();
    state.sessions[sessionId] = {
      tabId: tab.id,
      title: tab.title || "",
      url: tab.url || "",
      clicks: [],
      viewport: null,
      startedAt: Date.now(),
    };
    state.active = sessionId;
    await writeState(state);
  });

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "start", sessionId });
  } catch (err) {
    console.warn("Cursorful companion: cannot attach to this tab", err);
    await serialized(async () => {
      const state = await readState();
      delete state.sessions[sessionId];
      if (state.active === sessionId) state.active = null;
      await writeState(state);
    });
    await setBadge("!", "#dc2626", tab.id);
    return;
  }

  await setBadge("REC", "#16a34a", tab.id);

  const studioTabId = await openStudio();
  await ensureBridge(studioTabId);
});

async function handleClicks(message, tabId) {
  await serialized(async () => {
    const state = await readState();
    const entry = Object.entries(state.sessions).find(([, s]) => s.tabId === tabId);
    if (!entry) return;
    const [, session] = entry;
    session.clicks.push(...message.clicks);
    if (session.clicks.length > MAX_CLICKS) {
      session.clicks = session.clicks.slice(-MAX_CLICKS);
    }
    if (message.viewport) session.viewport = message.viewport;
    await writeState(state);
  });
}

async function handleBridge(message, sendResponse) {
  const action = message.action;

  if (action === "ping") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return;
  }

  if (action === "session" || action === "status") {
    const state = await readState();
    const session = state.active ? state.sessions[state.active] : null;
    sendResponse({
      ok: true,
      active: Boolean(session),
      session: session ? state.active : null,
      clicks: session ? session.clicks.length : 0,
      startedAt: session ? session.startedAt : 0,
      title: session ? session.title : null,
    });
    return;
  }

  if (action === "collect") {
    const collected = await serialized(async () => {
      const state = await readState();
      const id = message.payload?.session || state.active;
      const session = id ? state.sessions[id] : null;
      if (!session) return { clicks: [], viewport: null, startedAt: 0 };
      const payload = {
        clicks: session.clicks,
        viewport: session.viewport,
        startedAt: session.startedAt,
        title: session.title,
        tabId: session.tabId,
      };
      delete state.sessions[id];
      if (state.active === id) state.active = null;
      await writeState(state);
      return payload;
    });

    if (collected.tabId) {
      await chrome.tabs.sendMessage(collected.tabId, { type: "stop" }).catch(() => {});
      await setBadge("", null, collected.tabId);
      delete collected.tabId;
    }
    sendResponse(collected);
    return;
  }

  sendResponse({ ok: false, error: `unknown action: ${action}` });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "clicks" && sender.tab && Array.isArray(message.clicks)) {
    handleClicks(message, sender.tab.id);
    return;
  }

  if (message.type === "bridge") {
    handleBridge(message, sendResponse).catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  setBadge("");
});
