/* Studio: wiring for capture, auto-zoom, editing, and export. */

import { ScreenCapture } from "./capture.js";
import { generateDemoClip } from "./demo.js";
import { exportProject, pickExportFormat, downloadBlob } from "./export.js";
import { drawFrame } from "./render.js";
import { Timeline } from "./timeline.js";
import { sampleClicks } from "./clicks.js";
import {
  clamp,
  outputSize,
  segmentsFromClicks,
  uid,
} from "./zoom.js";
import { getBlob, getProject, lastProjectId, rememberLast, saveProject } from "./store.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const els = {
  projectName: $("#projectName"),
  extStatus: $("#extStatus"),
  extStatusText: $("#extStatusText"),
  btnNew: $("#btnNew"),
  btnRecord: $("#btnRecord"),
  btnExport: $("#btnExport"),
  stage: $("#stage"),
  stageEmpty: $("#stageEmpty"),
  stageFrame: $("#stageFrame"),
  canvas: $("#preview"),
  transport: $("#transport"),
  btnPlay: $("#btnPlay"),
  timecode: $("#timecode"),
  scrub: $("#scrub"),
  btnPrevSeg: $("#btnPrevSeg"),
  btnNextSeg: $("#btnNextSeg"),
  panelZoom: $("#panelZoom"),
  zoomRange: $("#zoomRange"),
  depth: $("#depth"),
  depthValue: $("#depthValue"),
  btnFocus: $("#btnFocus"),
  btnDeleteSeg: $("#btnDeleteSeg"),
  focusNote: $("#focusNote"),
  segAspect: $("#segAspect"),
  selRes: $("#selRes"),
  segBg: $("#segBg"),
  segFrame: $("#segFrame"),
  segCam: $("#segCam"),
  camOptions: $("#camOptions"),
  segShape: $("#segShape"),
  camSize: $("#camSize"),
  camSizeValue: $("#camSizeValue"),
  btnCrop: $("#btnCrop"),
  btnCropReset: $("#btnCropReset"),
  cropNote: $("#cropNote"),
  clicksNote: $("#clicksNote"),
  btnSample: $("#btnSample"),
  btnClearZooms: $("#btnClearZooms"),
  extSession: $("#extSession"),
  segCount: $("#segCount"),
  btnAddZoom: $("#btnAddZoom"),
  btnSplit: $("#btnSplit"),
  tlRuler: $("#tlRuler"),
  tlLane: $("#tlLane"),
  tlBody: $("#tlBody"),
  tlEmpty: $("#tlEmpty"),
  playhead: $("#playhead"),
  recOverlay: $("#recOverlay"),
  recSub: $("#recSub"),
  recOptions: $("#recOptions"),
  recState: $("#recState"),
  recTimer: $("#recTimer"),
  recMeta: $("#recMeta"),
  recError: $("#recError"),
  recCancel: $("#recCancel"),
  recStart: $("#recStart"),
  recStop: $("#recStop"),
  optMic: $("#optMic"),
  optCam: $("#optCam"),
  optAudio: $("#optAudio"),
  expOverlay: $("#expOverlay"),
  expSub: $("#expSub"),
  expSpecs: $("#expSpecs"),
  expBar: $("#expBar"),
  expNote: $("#expNote"),
  expCancel: $("#expCancel"),
  expSave: $("#expSave"),
  toast: $("#toast"),
  video: $("#sourceVideo"),
  camVideo: $("#webcamVideo"),
};

const ctx = els.canvas.getContext("2d");

const state = {
  project: null,
  videoBlob: null,
  camBlob: null,
  playing: false,
  raf: 0,
  selected: null,
  capture: null,
  recording: false,
  recTimer: 0,
  cropMode: false,
  focusMode: false,
  cropDrag: null,
  exportCancel: false,
  exportBlob: null,
  ext: { id: null, session: null },
  clicks: [],
  saveTimer: 0,
};

/* ------------------------------------------------------------------ helpers */

function toast(message, ms = 4200) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add("is-on"));
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.classList.remove("is-on");
    setTimeout(() => { els.toast.hidden = true; }, 220);
  }, ms);
}

function fmtTime(t) {
  const total = Math.max(0, t || 0);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

function slug(name) {
  return (name || "demo")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || "demo";
}

function videoDuration() {
  const d = els.video.duration;
  if (Number.isFinite(d) && d > 0) return d;
  const stored = state.project?.source?.duration;
  return Number.isFinite(stored) && stored > 0 ? stored : 0;
}

function hasProject() {
  return Boolean(state.project && state.videoBlob);
}

/* --------------------------------------------------------------- project IO */

function blankProject(name = "Untitled demo") {
  const now = Date.now();
  return {
    id: `p_${now.toString(36)}`,
    name,
    createdAt: now,
    updatedAt: now,
    blobId: `b_${now.toString(36)}`,
    camBlobId: null,
    source: { width: 1280, height: 720, duration: 0 },
    output: { aspect: "16:9", height: 1080 },
    style: {
      background: "hidden",
      frame: "hidden",
      cam: { layout: "off", shape: "circle", size: 18 },
    },
    crop: { x: 0, y: 0, w: 1, h: 1 },
    timeline: [],
    meta: { clicks: 0, autoZooms: 0 },
  };
}

function saveSoon() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, 350);
}

async function save() {
  if (!state.project) return;
  state.project.updatedAt = Date.now();
  try {
    await saveProject(state.project, { videoBlob: state.videoBlob, camBlob: state.camBlob });
  } catch (err) {
    console.warn("save failed", err);
    toast("Could not save locally. Storage may be full.");
  }
}

function applyOutput() {
  const { width, height } = outputSize(state.project.output);
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
  }
  draw();
}

/* ----------------------------------------------------------------- playback */

function draw(t = els.video.currentTime) {
  if (!state.project) return;
  drawFrame(ctx, {
    video: els.video,
    camVideo: els.camVideo.src ? els.camVideo : null,
    project: state.project,
    t: t || 0,
  });
  updateTransport();
}

function updateTransport() {
  const duration = videoDuration();
  const t = els.video.currentTime || 0;
  els.timecode.textContent = `${fmtTime(t)} / ${fmtTime(duration)}`;
  const pct = duration ? clamp(t / duration, 0, 1) : 0;
  els.scrub.value = String(Math.round(pct * 1000));
  els.scrub.style.setProperty("--p", `${pct * 100}%`);
  timeline.setTime(t);
}

function loop() {
  if (!state.playing) return;
  draw();
  if (els.camVideo.src && Math.abs(els.camVideo.currentTime - els.video.currentTime) > 0.12) {
    els.camVideo.currentTime = els.video.currentTime;
  }
  if (els.video.ended) {
    stopPlayback();
    return;
  }
  state.raf = requestAnimationFrame(loop);
}

function startPlayback() {
  if (!hasProject()) return;
  state.playing = true;
  els.btnPlay.querySelector(".i-play").hidden = true;
  els.btnPlay.querySelector(".i-pause").hidden = false;
  els.btnPlay.setAttribute("aria-label", "Pause");
  els.video.play().catch(() => {});
  if (els.camVideo.src) els.camVideo.play().catch(() => {});
  cancelAnimationFrame(state.raf);
  state.raf = requestAnimationFrame(loop);
}

function stopPlayback() {
  state.playing = false;
  els.video.pause();
  els.camVideo.pause();
  cancelAnimationFrame(state.raf);
  els.btnPlay.querySelector(".i-play").hidden = false;
  els.btnPlay.querySelector(".i-pause").hidden = true;
  els.btnPlay.setAttribute("aria-label", "Play");
  draw();
}

function togglePlayback() {
  if (state.playing) stopPlayback();
  else startPlayback();
}

function seek(t) {
  if (!hasProject()) return;
  const duration = videoDuration();
  const target = clamp(t, 0, Math.max(0, duration - 0.02));
  const wasPlaying = state.playing;
  if (wasPlaying) stopPlayback();
  const apply = () => {
    draw(target);
    if (wasPlaying) startPlayback();
  };
  if (Math.abs(els.video.currentTime - target) < 0.01) {
    apply();
    return;
  }
  const onSeeked = () => {
    els.video.removeEventListener("seeked", onSeeked);
    apply();
  };
  els.video.addEventListener("seeked", onSeeked);
  els.video.currentTime = target;
  if (els.camVideo.src) els.camVideo.currentTime = target;
}

/* ------------------------------------------------------------------- load */

function once(el, event, timeout = 4000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener(event, done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeout);
    el.addEventListener(event, done);
  });
}

async function prepareVideo(el, blob) {
  if (blob) {
    if (el.dataset.url) URL.revokeObjectURL(el.dataset.url);
    const url = URL.createObjectURL(blob);
    el.dataset.url = url;
    el.src = url;
  }
  el.load();

  if (el.readyState < 1) await once(el, "loadedmetadata", 6000);
  if (el.readyState < 2) await once(el, "loadeddata", 4000);

  // MediaRecorder WebM can report an unknown duration, which makes a seek
  // stall. Try a short first seek to flush real frames, but never block on it.
  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener("seeked", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 1500);
    el.addEventListener("seeked", done);
    try { el.currentTime = 0.001; } catch { done(); }
  });
}

async function adoptRecording({ videoBlob, camBlob, duration, width, height, name }) {
  const project = blankProject(name || els.projectName.value || "Untitled demo");
  if (state.ext.id) project.meta.companion = state.ext.id;

  project.source = {
    width: width || els.video.videoWidth || 1280,
    height: height || els.video.videoHeight || 720,
    duration: duration || 0,
  };
  if (camBlob) project.camBlobId = `c_${Date.now().toString(36)}`;

  state.project = project;
  state.videoBlob = videoBlob;
  state.camBlob = camBlob || null;
  state.selected = null;

  els.projectName.value = project.name;
  els.stageEmpty.hidden = true;
  els.stageFrame.hidden = false;
  els.transport.hidden = false;

  await prepareVideo(els.video, videoBlob);
  if (camBlob) await prepareVideo(els.camVideo, camBlob);
  else els.camVideo.removeAttribute("src");

  project.source.duration = Number.isFinite(els.video.duration)
    ? els.video.duration
    : (Number.isFinite(duration) ? duration : 0);

  applyOutput();
  syncControlsFromProject();
  timeline.setDuration(videoDuration());
  timeline.setSegments(project.timeline);
  timeline.setSelected(null);
  updateZoomPanel();
  els.btnExport.disabled = false;
  els.btnAddZoom.disabled = false;
  draw(0);
  await save();
}

async function restoreLast() {
  const id = lastProjectId();
  if (!id) return false;
  let project;
  try {
    project = await getProject(id);
  } catch {
    return false;
  }
  if (!project) return false;
  const blob = await getBlob(project.blobId);
  if (!blob) return false;

  state.project = project;
  state.videoBlob = blob;
  state.camBlob = project.camBlobId ? await getBlob(project.camBlobId) : null;

  els.projectName.value = project.name;
  els.stageEmpty.hidden = true;
  els.stageFrame.hidden = false;
  els.transport.hidden = false;
  els.btnExport.disabled = false;
  els.btnAddZoom.disabled = false;

  await prepareVideo(els.video, blob);
  if (state.camBlob) await prepareVideo(els.camVideo, state.camBlob);

  project.source.duration = Number.isFinite(els.video.duration)
    ? els.video.duration
    : (project.source.duration || 0);
  applyOutput();
  syncControlsFromProject();
  timeline.setDuration(videoDuration());
  timeline.setSegments(project.timeline);
  updateZoomPanel();
  updateClicksNote();
  draw(0);
  return true;
}

/* ---------------------------------------------------------------- inspector */

function syncControlsFromProject() {
  const p = state.project;
  $$("#segAspect button").forEach((b) => b.classList.toggle("is-on", b.dataset.value === p.output.aspect));
  els.selRes.value = String(p.output.height);
  $$("#segBg button").forEach((b) => b.classList.toggle("is-on", b.dataset.value === p.style.background));
  $$("#segFrame button").forEach((b) => b.classList.toggle("is-on", b.dataset.value === p.style.frame));
  $$("#segCam button").forEach((b) => b.classList.toggle("is-on", b.dataset.value === p.style.cam.layout));
  $$("#segShape button").forEach((b) => b.classList.toggle("is-on", b.dataset.value === p.style.cam.shape));
  els.camSize.value = String(p.style.cam.size);
  els.camSizeValue.textContent = `${p.style.cam.size}%`;
  els.camOptions.hidden = p.style.cam.layout === "off";
  updateCropNote();
  updateClicksNote();
  updateCount();
}

function updateCount() {
  const n = state.project?.timeline.length || 0;
  els.segCount.textContent = `${n} zoom${n === 1 ? "" : "s"}`;
  els.btnSplit.disabled = n === 0;
}

function selectSegment(id) {
  state.selected = id;
  timeline.setSelected(id);
  updateZoomPanel();
}

function updateZoomPanel() {
  const seg = state.project?.timeline.find((s) => s.id === state.selected);
  els.panelZoom.hidden = !seg;
  if (!seg) return;
  els.zoomRange.textContent = `${seg.start.toFixed(1)}s to ${seg.end.toFixed(1)}s`;
  els.depth.value = String(seg.depth);
  els.depthValue.textContent = `${seg.depth.toFixed(2)}x`;
  const { x, y } = seg.focus;
  const cx = Math.round((x / (els.video.videoWidth || 1)) * 100);
  const cy = Math.round((y / (els.video.videoHeight || 1)) * 100);
  els.focusNote.textContent = `Focus: ${cx}% across, ${cy}% down`;
}

function updateCropNote() {
  const c = state.project?.crop || { x: 0, y: 0, w: 1, h: 1 };
  const full = c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;
  els.cropNote.textContent = full
    ? "Full frame"
    : `${Math.round(c.w * 100)}% x ${Math.round(c.h * 100)}%, from ${Math.round(c.x * 100)}%, ${Math.round(c.y * 100)}%`;
}

function updateClicksNote() {
  const clicks = state.clicks.length || state.project?.meta?.clicks || 0;
  const zooms = state.project?.timeline.filter((s) => s.source === "auto").length || 0;
  if (!clicks) {
    els.clicksNote.textContent = "No click data yet. Record with the companion, or load sample clicks.";
  } else {
    els.clicksNote.textContent = `${clicks} clicks, ${zooms} auto zoom${zooms === 1 ? "" : "s"}.`;
  }
}

function setStatus(kind, text) {
  els.extStatus.dataset.state = kind;
  els.extStatusText.textContent = text;
}

/* -------------------------------------------------------------- auto zoom */

function applyAutoZooms(clicks, viewport, { relative = false } = {}) {
  const duration = videoDuration();
  const vw = els.video.videoWidth;
  const vh = els.video.videoHeight;
  if (!vw || !vh || !duration) return false;

  const videoAspect = vw / vh;
  const viewAspect = viewport.width / viewport.height;
  if (Math.abs(videoAspect - viewAspect) / viewAspect > 0.04) {
    toast("Auto-zoom skipped: the recording does not match the tab viewport. Add zooms by hand.", 6000);
    return false;
  }

  const timed = clicks
    .map((c) => ({ ...c, t: relative ? c.t : (c.t - state.recStartedAt) / 1000 }))
    .filter((c) => c.t >= 0 && c.t <= duration);

  if (timed.length < 2) {
    toast("Not enough clicks inside the recording window.");
    return false;
  }

  state.clicks = timed;
  const segments = segmentsFromClicks(timed, {
    videoWidth: vw,
    videoHeight: vh,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    duration,
  });

  state.project.timeline = segments;
  state.project.meta.clicks = timed.length;
  state.project.meta.autoZooms = segments.length;
  timeline.setSegments(segments);
  timeline.setSelected(null);
  state.selected = null;
  updateZoomPanel();
  updateCount();
  updateClicksNote();
  draw();
  saveSoon();

  if (segments.length) {
    toast(`Placed ${segments.length} zoom${segments.length === 1 ? "" : "s"} from ${timed.length} clicks.`);
  } else {
    toast("Clicks were too scattered to form a zoom. Add one at the playhead.");
  }
  return true;
}

function loadSampleClicks() {
  if (!hasProject()) return;
  const duration = videoDuration();
  const clicks = sampleClicks(duration, { width: els.video.videoWidth, height: els.video.videoHeight });
  applyAutoZooms(clicks, { width: els.video.videoWidth, height: els.video.videoHeight }, { relative: true });
}

/* --------------------------------------------------------------- companion */

function chromeSend(message, timeout = 4000) {
  return new Promise((resolve) => {
    const runtime = window.chrome?.runtime;
    if (!state.ext.id || !runtime?.sendMessage) {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeout);
    try {
      runtime.sendMessage(state.ext.id, message, (response) => {
        void runtime.lastError;
        finish(response || null);
      });
    } catch {
      finish(null);
    }
  });
}

async function collectClicks() {
  if (!state.ext.id || !state.ext.session) return null;
  const result = await chromeSend({ type: "collect", session: state.ext.session }, 8000);
  if (!result || !Array.isArray(result.clicks)) return null;
  return result;
}

function initCompanion() {
  const params = new URLSearchParams(location.search);
  const extId = params.get("ext");
  const session = params.get("session");

  if (extId) {
    state.ext.id = extId;
    state.ext.session = session;
    try {
      sessionStorage.setItem("cursorful:ext", JSON.stringify({ id: extId, session }));
    } catch { /* ignore */ }
  } else {
    try {
      const saved = JSON.parse(sessionStorage.getItem("cursorful:ext") || "null");
      if (saved?.id) {
        state.ext.id = saved.id;
        state.ext.session = saved.session;
      }
    } catch { /* ignore */ }
  }

  if (state.ext.id) {
    setStatus("live", "Companion ready");
    els.extSession.textContent = state.ext.session
      ? `Session ${state.ext.session.slice(0, 10)} is capturing clicks.`
      : "Connected. Start a recording from the companion to capture clicks.";
  } else {
    setStatus("local", "Local only");
    els.extSession.textContent = "No session. Click the companion's toolbar button on the tab you want to record.";
  }
}

/* ------------------------------------------------------------------- record */

function openRecorder() {
  if (!hasProject()) stopPlayback();
  els.recError.hidden = true;
  els.recOptions.hidden = false;
  els.recState.hidden = true;
  els.recStart.hidden = false;
  els.recStop.hidden = true;
  els.recCancel.hidden = false;
  els.recSub.textContent = "Pick the tab you want to record. Chrome will ask which surface to share.";
  els.recOverlay.hidden = false;
  els.recStart.focus();
}

function closeRecorder() {
  els.recOverlay.hidden = true;
}

function startTimer() {
  clearInterval(state.recTimer);
  const tick = async () => {
    if (!state.capture) return;
    els.recTimer.textContent = fmtTime(state.capture.elapsed).replace(/\.\d$/, "");
    if (state.ext.session) {
      const status = await chromeSend({ type: "status", session: state.ext.session }, 1200);
      if (status && Number.isFinite(status.clicks)) {
        els.recMeta.textContent = `${status.clicks} clicks captured`;
      }
    }
  };
  state.recTimer = setInterval(tick, 1000);
  tick();
}

async function startRecording() {
  els.recError.hidden = true;
  els.recStart.disabled = true;
  els.recStart.textContent = "Starting…";

  try {
    state.capture = new ScreenCapture({
      onDisplayEnded: () => {
        if (state.recording) finishRecording();
      },
    });
    state.recStartedAt = Date.now();
    const info = await state.capture.start({
      tabAudio: els.optAudio.checked,
      mic: els.optMic.checked,
      cam: els.optCam.checked,
    });
    state.recStartedAt = state.capture.startedAt;
    state.recording = true;

    els.recOptions.hidden = true;
    els.recState.hidden = false;
    els.recStart.hidden = true;
    els.recStop.hidden = false;
    els.recCancel.hidden = true;
    els.recSub.textContent = "Recording. Switch to the tab you picked and click through your demo.";
    els.recMeta.textContent = info.hasAudio ? "Capturing with audio" : "Capturing (no audio track)";
    startTimer();
  } catch (err) {
    state.capture = null;
    els.recStart.disabled = false;
    els.recStart.textContent = "Start recording";
    const message = err?.name === "NotAllowedError"
      ? "You cancelled the picker or denied the permission. Nothing was recorded."
      : err?.message || "Could not start capture.";
    els.recError.textContent = message;
    els.recError.hidden = false;
  }
}

async function finishRecording() {
  if (!state.capture || !state.recording) return;
  state.recording = false;
  clearInterval(state.recTimer);

  els.recStop.disabled = true;
  els.recStop.textContent = "Finishing…";

  let result;
  try {
    result = await state.capture.stop();
  } catch (err) {
    toast(`Recording failed: ${err.message}`);
    result = null;
  }
  state.capture = null;
  els.recStop.disabled = false;
  els.recStop.textContent = "Stop and edit";
  closeRecorder();

  if (!result || !result.videoBlob) {
    toast("No video was captured. Try again and keep the share alive until you press stop.");
    return;
  }

  const name = els.projectName.value.trim() || "Untitled demo";
  await adoptRecording({
    videoBlob: result.videoBlob,
    camBlob: result.camBlob,
    duration: result.duration,
    width: result.width,
    height: result.height,
    name,
  });

  const log = await collectClicks();
  if (log && log.clicks?.length) {
    const viewport = log.viewport || { width: result.width, height: result.height };
    state.recStartedAt = log.startedAt || result.startedAt;
    applyAutoZooms(log.clicks, viewport);
  } else if (state.ext.session) {
    toast("No clicks arrived from the companion. Add zooms manually or reload sample clicks.", 5200);
  } else {
    toast("Recorded. Add zooms at the playhead, or install the companion to auto-place them.", 5200);
  }
}

/* ------------------------------------------------------------------- export */

function openExport() {
  if (!hasProject()) return;
  const format = pickExportFormat();
  if (!format) {
    toast("This browser cannot encode video. Try Chrome or Edge.");
    return;
  }
  const { width, height } = outputSize(state.project.output);
  els.expSpecs.innerHTML = `
    <dt>Format</dt><dd>${format.label}</dd>
    <dt>Size</dt><dd>${width} x ${height}</dd>
    <dt>Length</dt><dd>${fmtTime(videoDuration())}</dd>
    <dt>Zooms</dt><dd>${state.project.timeline.length}</dd>`;
  els.expBar.style.width = "0%";
  els.expNote.textContent = "This renders in real time, so a long clip takes about as long as it plays.";
  els.expSave.hidden = true;
  els.expCancel.textContent = "Cancel";
  els.expCancel.disabled = false;
  els.expOverlay.hidden = false;
  state.exportCancel = false;
  state.exportBlob = null;
  runExport(format);
}

async function runExport(format) {
  stopPlayback();
  try {
    const result = await exportProject({
      project: state.project,
      video: els.video,
      camVideo: els.camVideo.src ? els.camVideo : null,
      canvas: els.canvas,
      onProgress: (p) => {
        els.expBar.style.width = `${Math.round(p * 100)}%`;
      },
      shouldCancel: () => state.exportCancel,
    });

    if (!result) {
      els.expSub.textContent = "Export cancelled.";
      els.expCancel.disabled = false;
      els.expCancel.textContent = "Close";
      draw(0);
      return;
    }

    state.exportBlob = result.blob;
    state.exportExt = result.format.ext;
    els.expSub.textContent = "Done. Save the file, or close and keep editing.";
    els.expBar.style.width = "100%";
    els.expNote.textContent = `Export took ${fmtTime(result.duration)} of source time. ${Math.round(result.blob.size / 1024)} KB.`;
    els.expSave.hidden = false;
    els.expCancel.textContent = "Close";
    draw(0);
  } catch (err) {
    els.expSub.textContent = "Export failed.";
    els.expNote.textContent = err.message || String(err);
    els.expCancel.disabled = false;
    els.expCancel.textContent = "Close";
    draw(0);
  }
}

function saveExport() {
  if (!state.exportBlob) return;
  const name = `${slug(state.project.name)}-${new Date().toISOString().slice(0, 10)}.${state.exportExt || "webm"}`;
  downloadBlob(state.exportBlob, name);
  toast(`Saved ${name}`);
  els.expOverlay.hidden = true;
}

/* -------------------------------------------------------------------- crop */

function enterCropMode() {
  if (!hasProject()) return;
  state.cropMode = true;
  state.focusMode = false;
  els.stageFrame.classList.add("is-cropping");
  toast("Drag a rectangle on the preview. Press Escape to cancel.", 6000);
  ensureCropLayer();
}

function exitCropMode() {
  state.cropMode = false;
  state.cropDrag = null;
  els.stageFrame.classList.remove("is-cropping");
  const layer = $(".cropLayer", els.stageFrame);
  if (layer) layer.remove();
}

function ensureCropLayer() {
  if ($(".cropLayer", els.stageFrame)) return;
  const layer = document.createElement("div");
  layer.className = "cropLayer";
  layer.innerHTML = '<div class="cropLayer__rect" hidden></div>';
  els.stageFrame.appendChild(layer);
}

function normPoint(e) {
  const rect = els.canvas.getBoundingClientRect();
  return {
    x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
  };
}

function onStagePointerDown(e) {
  if (!state.cropMode) {
    if (state.focusMode && state.selected) {
      const p = normPoint(e);
      const seg = state.project.timeline.find((s) => s.id === state.selected);
      if (seg) {
        seg.focus = {
          x: Math.round(p.x * els.video.videoWidth),
          y: Math.round(p.y * els.video.videoHeight),
        };
        state.focusMode = false;
        els.btnFocus.classList.remove("is-on");
        updateZoomPanel();
        draw();
        saveSoon();
        toast("Focus moved.");
      }
    }
    return;
  }

  state.cropDrag = normPoint(e);
  const layer = $(".cropLayer", els.stageFrame);
  const rectEl = layer ? $(".cropLayer__rect", layer) : null;
  if (rectEl) rectEl.hidden = false;
  try { els.stageFrame.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointers */ }
  e.preventDefault();
}

function onStagePointerMove(e) {
  if (!state.cropMode || !state.cropDrag) return;
  const layer = $(".cropLayer", els.stageFrame);
  const rectEl = layer ? $(".cropLayer__rect", layer) : null;
  if (!rectEl) return;
  const p = normPoint(e);
  const x = Math.min(p.x, state.cropDrag.x);
  const y = Math.min(p.y, state.cropDrag.y);
  const w = Math.abs(p.x - state.cropDrag.x);
  const h = Math.abs(p.y - state.cropDrag.y);
  rectEl.style.left = `${x * 100}%`;
  rectEl.style.top = `${y * 100}%`;
  rectEl.style.width = `${w * 100}%`;
  rectEl.style.height = `${h * 100}%`;
  state.cropPending = { x, y, w, h };
}

function onStagePointerUp() {
  if (!state.cropMode || !state.cropDrag) return;
  const pending = state.cropPending;
  state.cropDrag = null;
  state.cropPending = null;
  if (!pending || pending.w < 0.05 || pending.h < 0.05) {
    toast("Crop too small. Drag a larger rectangle.");
    return;
  }
  state.project.crop = pending;
  exitCropMode();
  updateCropNote();
  draw();
  saveSoon();
}

/* ---------------------------------------------------------------- add zoom */

function addZoomAt(t) {
  if (!hasProject()) return;
  const duration = videoDuration();
  const start = clamp(t - 0.5, 0, Math.max(0, duration - 1.2));
  const end = clamp(start + 2, 0.8, duration);
  const seg = {
    id: uid("z"),
    kind: "zoom",
    start: Math.round(start * 100) / 100,
    end: Math.round(end * 100) / 100,
    focus: { x: els.video.videoWidth / 2, y: els.video.videoHeight / 2 },
    depth: 1.8,
    clicks: 0,
    source: "manual",
  };
  state.project.timeline = [...state.project.timeline, seg].sort((a, b) => a.start - b.start);
  timeline.setSegments(state.project.timeline);
  selectSegment(seg.id);
  updateCount();
  draw();
  saveSoon();
}

function deleteSelected() {
  if (!state.selected) return;
  state.project.timeline = state.project.timeline.filter((s) => s.id !== state.selected);
  state.selected = null;
  timeline.setSegments(state.project.timeline);
  timeline.setSelected(null);
  updateZoomPanel();
  updateCount();
  updateClicksNote();
  draw();
  saveSoon();
}

function splitAtPlayhead() {
  const t = els.video.currentTime;
  const seg = state.project.timeline.find((s) => t > s.start + 0.4 && t < s.end - 0.4);
  if (!seg) {
    toast("Put the playhead inside a zoom to split it.");
    return;
  }
  const right = {
    ...seg,
    id: uid("z"),
    start: Math.round(t * 100) / 100,
    focus: { ...seg.focus },
    source: seg.source || "manual",
  };
  seg.end = Math.round(t * 100) / 100;
  state.project.timeline = [...state.project.timeline, right].sort((a, b) => a.start - b.start);
  timeline.setSegments(state.project.timeline);
  selectSegment(right.id);
  updateCount();
  draw();
  saveSoon();
}

/* -------------------------------------------------------------------- init */

const timeline = new Timeline({
  ruler: els.tlRuler,
  lane: els.tlLane,
  playhead: els.playhead,
  body: els.tlBody,
  empty: els.tlEmpty,
  onSeek: (t) => seek(t),
  onSelect: (id) => selectSegment(id),
  onChange: () => { saveSoon(); updateZoomPanel(); },
  onLive: () => { updateZoomPanel(); draw(); },
  onCreate: (t) => addZoomAt(t),
});

function bind() {
  els.btnPlay.addEventListener("click", togglePlayback);
  els.scrub.addEventListener("input", () => {
    const duration = videoDuration();
    seek((Number(els.scrub.value) / 1000) * duration);
  });

  els.btnRecord.addEventListener("click", openRecorder);
  $$('[data-action="record"]').forEach((b) => b.addEventListener("click", openRecorder));
  $$('[data-action="demo"]').forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      b.textContent = "Rendering 6s clip…";
      try {
        const blob = await generateDemoClip({
          seconds: 6,
          onProgress: (p) => { b.textContent = `Rendering ${Math.round(p * 100)}%`; },
        });
        await adoptRecording({
          videoBlob: blob,
          duration: 6,
          width: 1280,
          height: 720,
          name: "Demo clip",
        });
        loadSampleClicks();
      } catch (err) {
        toast(`Could not build the demo clip: ${err.message}`);
      } finally {
        b.disabled = false;
        b.textContent = "Generate a 6s demo clip";
      }
    })
  );

  els.recStart.addEventListener("click", startRecording);
  els.recStop.addEventListener("click", finishRecording);
  els.recCancel.addEventListener("click", closeRecorder);

  els.btnExport.addEventListener("click", openExport);
  els.expCancel.addEventListener("click", () => {
    if (state.exportBlob) {
      els.expOverlay.hidden = true;
      return;
    }
    state.exportCancel = true;
    els.expCancel.disabled = true;
    els.expCancel.textContent = "Stopping…";
  });
  els.expSave.addEventListener("click", saveExport);

  els.btnNew.addEventListener("click", async () => {
    if (state.recording) return;
    stopPlayback();
    state.project = null;
    state.videoBlob = null;
    state.camBlob = null;
    state.selected = null;
    state.clicks = [];
    els.video.removeAttribute("src");
    els.camVideo.removeAttribute("src");
    els.stageEmpty.hidden = false;
    els.stageFrame.hidden = true;
    els.transport.hidden = true;
    els.btnExport.disabled = true;
    els.btnAddZoom.disabled = true;
    els.projectName.value = "Untitled demo";
    els.panelZoom.hidden = true;
    timeline.setDuration(0);
    timeline.setSegments([]);
    updateCount();
    updateClicksNote();
  });

  els.projectName.addEventListener("input", () => {
    if (!state.project) return;
    state.project.name = els.projectName.value.trim() || "Untitled demo";
    saveSoon();
  });

  $$("#segAspect button").forEach((b) =>
    b.addEventListener("click", () => {
      if (!state.project) return;
      $$("#segAspect button").forEach((x) => x.classList.toggle("is-on", x === b));
      state.project.output.aspect = b.dataset.value;
      applyOutput();
      saveSoon();
    })
  );

  els.selRes.addEventListener("change", () => {
    if (!state.project) return;
    state.project.output.height = Number(els.selRes.value);
    applyOutput();
    saveSoon();
  });

  const styleSegment = (el, apply) => {
    $$("button", el).forEach((b) =>
      b.addEventListener("click", () => {
        if (!state.project) return;
        $$("button", el).forEach((x) => x.classList.toggle("is-on", x === b));
        apply(b.dataset.value);
        draw();
        saveSoon();
      })
    );
  };

  styleSegment(els.segBg, (v) => { state.project.style.background = v; });
  styleSegment(els.segFrame, (v) => { state.project.style.frame = v; });
  styleSegment(els.segCam, (v) => {
    state.project.style.cam.layout = v;
    els.camOptions.hidden = v === "off";
    if (v !== "off" && !state.camBlob) {
      toast("This project has no camera track. Record with the camera on to use it.", 5000);
    }
  });
  styleSegment(els.segShape, (v) => { state.project.style.cam.shape = v; });

  els.camSize.addEventListener("input", () => {
    if (!state.project) return;
    state.project.style.cam.size = Number(els.camSize.value);
    els.camSizeValue.textContent = `${els.camSize.value}%`;
    draw();
    saveSoon();
  });

  els.depth.addEventListener("input", () => {
    const seg = state.project?.timeline.find((s) => s.id === state.selected);
    if (!seg) return;
    seg.depth = Number(els.depth.value);
    els.depthValue.textContent = `${seg.depth.toFixed(2)}x`;
    draw();
    timeline.render();
  });
  els.depth.addEventListener("change", saveSoon);

  els.btnFocus.addEventListener("click", () => {
    if (!state.selected) return;
    state.focusMode = true;
    els.btnFocus.classList.add("is-on");
    toast("Click on the preview to place the zoom focus.");
  });

  els.btnDeleteSeg.addEventListener("click", deleteSelected);

  els.btnCrop.addEventListener("click", () => {
    if (state.cropMode) exitCropMode();
    else enterCropMode();
  });
  els.btnCropReset.addEventListener("click", () => {
    if (!state.project) return;
    state.project.crop = { x: 0, y: 0, w: 1, h: 1 };
    updateCropNote();
    draw();
    saveSoon();
  });

  els.btnSample.addEventListener("click", loadSampleClicks);
  els.btnClearZooms.addEventListener("click", () => {
    if (!state.project) return;
    state.project.timeline = [];
    state.selected = null;
    state.clicks = [];
    timeline.setSegments([]);
    updateZoomPanel();
    updateCount();
    updateClicksNote();
    draw();
    saveSoon();
  });

  els.btnAddZoom.addEventListener("click", () => addZoomAt(els.video.currentTime));
  els.btnSplit.addEventListener("click", splitAtPlayhead);

  els.btnPrevSeg.addEventListener("click", () => {
    const t = els.video.currentTime;
    const prev = [...state.project?.timeline || []].reverse().find((s) => s.start < t - 0.1);
    seek(prev ? prev.start : 0);
  });
  els.btnNextSeg.addEventListener("click", () => {
    const t = els.video.currentTime;
    const next = (state.project?.timeline || []).find((s) => s.start > t + 0.1);
    seek(next ? next.start : videoDuration());
  });

  els.stageFrame.addEventListener("pointerdown", onStagePointerDown);
  els.stageFrame.addEventListener("pointermove", onStagePointerMove);
  els.stageFrame.addEventListener("pointerup", onStagePointerUp);

  document.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "Escape") {
      if (state.cropMode) exitCropMode();
      if (state.focusMode) {
        state.focusMode = false;
        els.btnFocus.classList.remove("is-on");
      }
      if (!els.recOverlay.hidden && !state.recording) closeRecorder();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      togglePlayback();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.selected) {
      e.preventDefault();
      deleteSelected();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (state.selected) {
        const seg = state.project.timeline.find((s) => s.id === state.selected);
        if (seg) {
          const d = e.shiftKey ? 0.5 : 0.1;
          seg.start = Math.max(0, seg.start - d);
          seg.end = Math.max(seg.start + 0.3, seg.end - d);
          timeline.setSegments(state.project.timeline);
          draw();
          saveSoon();
        }
      } else {
        seek(els.video.currentTime - (e.shiftKey ? 5 : 1));
      }
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (state.selected) {
        const seg = state.project.timeline.find((s) => s.id === state.selected);
        if (seg) {
          const d = e.shiftKey ? 0.5 : 0.1;
          seg.start = Math.min(videoDuration() - 0.3, seg.start + d);
          seg.end = Math.min(videoDuration(), seg.end + d);
          timeline.setSegments(state.project.timeline);
          draw();
          saveSoon();
        }
      } else {
        seek(els.video.currentTime + (e.shiftKey ? 5 : 1));
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
      e.preventDefault();
      openExport();
    }
  });

  els.video.addEventListener("play", () => {
    if (!state.playing) startPlayback();
  });
  els.video.addEventListener("ended", () => stopPlayback());

  window.addEventListener("beforeunload", (e) => {
    if (state.recording) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

// Debug handle: lets local tests read state without scraping the DOM.
window.__studio = { state, draw, seek, addZoomAt, applyAutoZooms, timeline };

async function boot() {
  bind();
  initCompanion();
  updateCount();
  updateClicksNote();

  // Restore the last project so a reload keeps your work.
  const restored = await restoreLast().catch(() => false);
  if (!restored) {
    els.stageEmpty.hidden = false;
    els.stageFrame.hidden = true;
    els.transport.hidden = true;
    els.btnExport.disabled = true;
    els.btnAddZoom.disabled = true;
  }

  const format = pickExportFormat();
  if (!format) {
    toast("This browser cannot encode video. Preview and editing still work.", 7000);
  }
}

boot();
