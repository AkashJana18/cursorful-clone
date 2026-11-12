/* IndexedDB persistence: projects and their media blobs. */

const DB_NAME = "cursorful-studio";
const DB_VERSION = 1;
const LAST_KEY = "cursorful-studio:last";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB unavailable"));
  });
  return dbPromise;
}

function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveProject(project, { videoBlob, camBlob } = {}) {
  const db = await openDb();
  const tx = db.transaction(["projects", "blobs"], "readwrite");
  if (videoBlob) tx.objectStore("blobs").put(videoBlob, project.blobId);
  if (camBlob) tx.objectStore("blobs").put(camBlob, project.camBlobId);
  tx.objectStore("projects").put(project);
  await finished(tx);
  try { localStorage.setItem(LAST_KEY, project.id); } catch { /* private mode */ }
}

export async function getProject(id) {
  const db = await openDb();
  const tx = db.transaction("projects", "readonly");
  const req = tx.objectStore("projects").get(id);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getBlob(id) {
  if (!id) return null;
  const db = await openDb();
  const tx = db.transaction("blobs", "readonly");
  const req = tx.objectStore("blobs").get(id);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function listProjects() {
  const db = await openDb();
  const tx = db.transaction("projects", "readonly");
  const req = tx.objectStore("projects").getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProject(id) {
  const db = await openDb();
  const tx = db.transaction(["projects", "blobs"], "readwrite");
  tx.objectStore("projects").delete(id);
  await finished(tx);
}

export function lastProjectId() {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

export function rememberLast(id) {
  try { localStorage.setItem(LAST_KEY, id); } catch { /* ignore */ }
}
