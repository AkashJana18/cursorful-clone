/* Export: replay the canvas in real time and let the browser encode it. */

import { drawFrame } from "./render.js";

const FORMATS = [
  { mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", ext: "mp4", label: "MP4 (H.264 + AAC)" },
  { mime: "video/mp4;codecs=avc1.42E01E", ext: "mp4", label: "MP4 (H.264)" },
  { mime: "video/webm;codecs=vp9,opus", ext: "webm", label: "WebM (VP9 + Opus)" },
  { mime: "video/webm;codecs=vp8,opus", ext: "webm", label: "WebM (VP8 + Opus)" },
  { mime: "video/webm", ext: "webm", label: "WebM" },
];

export function pickExportFormat() {
  if (typeof MediaRecorder === "undefined") return null;
  return FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime)) || null;
}

const audioGraphs = new WeakMap();

function ensureAudioGraph(video) {
  if (audioGraphs.has(video)) return audioGraphs.get(video);
  let graph = null;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ac = new Ctx();
    const source = ac.createMediaElementSource(video);
    const gain = ac.createGain();
    gain.gain.value = 1;
    const dest = ac.createMediaStreamDestination();
    source.connect(gain);
    gain.connect(ac.destination);
    source.connect(dest);
    graph = { ac, gain, dest };
  } catch {
    graph = null;
  }
  audioGraphs.set(video, graph);
  return graph;
}

function seek(video, time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.01 && video.readyState >= 2) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

/**
 * Render the project to a Blob by playing it through the canvas.
 * @returns {Promise<{blob: Blob, format: object, duration: number}>}
 */
export async function exportProject({ project, video, camVideo, canvas, onProgress, shouldCancel }) {
  const format = pickExportFormat();
  if (!format) throw new Error("This browser cannot encode video with MediaRecorder.");

  const ctx = canvas.getContext("2d", { alpha: false });
  const fps = 30;
  const duration = video.duration && Number.isFinite(video.duration)
    ? video.duration
    : project.source?.duration || 0;

  const stream = canvas.captureStream(fps);
  const graph = ensureAudioGraph(video);
  if (graph) {
    try { await graph.ac.resume(); } catch { /* ignore */ }
    graph.gain.gain.value = 0;
    graph.dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  }

  const bitrate = Math.min(14_000_000, Math.round(canvas.width * canvas.height * fps * 0.1));
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mime,
    videoBitsPerSecond: bitrate,
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.addEventListener("stop", resolve, { once: true });
  });

  video.pause();
  await seek(video, 0);
  if (camVideo) {
    camVideo.pause();
    if (camVideo.readyState >= 1) await seek(camVideo, 0);
  }

  recorder.start(400);
  await video.play();
  if (camVideo) camVideo.play().catch(() => {});

  const cancelled = await new Promise((resolve) => {
    const tick = () => {
      if (shouldCancel && shouldCancel()) {
        resolve(true);
        return;
      }
      const t = video.currentTime;
      drawFrame(ctx, { video, camVideo, project, t });

      if (camVideo && camVideo.readyState >= 2 && Math.abs(camVideo.currentTime - t) > 0.12) {
        camVideo.currentTime = t;
      }
      if (onProgress && duration) onProgress(Math.min(1, t / duration));

      if (video.ended || (duration && t >= duration - 0.02)) {
        resolve(false);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  video.pause();
  if (camVideo) camVideo.pause();
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());

  if (graph) graph.gain.gain.value = 1;

  if (cancelled) {
    video.currentTime = 0;
    return null;
  }

  const blob = new Blob(chunks, { type: format.mime.split(";")[0] });
  video.currentTime = 0;
  if (camVideo) camVideo.currentTime = 0;
  return { blob, format, duration };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
