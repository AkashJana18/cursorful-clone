/* Camera math for auto-zoom.
   A zoom segment is a time window plus a focus point in source pixels.
   Everything here is pure so it can be reasoned about and tested. */

import { clusterClicks } from "./clicks.js";

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, p) => a + (b - a) * p;
export const easeInOut = (p) => {
  const t = clamp(p, 0, 1);
  return t * t * (3 - 2 * t);
};

export function uid(prefix = "s") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Sample the camera at time t.
 * `base` is the visible source rect at scale 1, in source pixels.
 * Returns the source rect to draw from, clamped so it never leaves the base.
 */
export function cameraAt(segments, t, base) {
  const still = { ...base, scale: 1, cx: base.x + base.w / 2, cy: base.y + base.h / 2 };
  if (!segments || segments.length === 0) return still;

  const seg = segments.find((s) => s.kind === "zoom" && t >= s.start && t <= s.end);
  if (!seg) return still;

  const dur = Math.max(0.001, seg.end - seg.start);
  const inDur = Math.min(0.35, dur * 0.3);
  const outDur = Math.min(0.6, dur * 0.35);

  let k = 1;
  if (t < seg.start + inDur) k = easeInOut((t - seg.start) / inDur);
  else if (t > seg.end - outDur) k = easeInOut((seg.end - t) / outDur);

  const depth = clamp(seg.depth || 1.8, 1, 4);
  const scale = 1 + (depth - 1) * k;
  const w = base.w / scale;
  const h = base.h / scale;

  const baseCx = base.x + base.w / 2;
  const baseCy = base.y + base.h / 2;
  const focusX = seg.focus?.x ?? baseCx;
  const focusY = seg.focus?.y ?? baseCy;

  const cx = clamp(lerp(baseCx, focusX, k), base.x + w / 2, base.x + base.w - w / 2);
  const cy = clamp(lerp(baseCy, focusY, k), base.y + h / 2, base.y + base.h - h / 2);

  return { x: cx - w / 2, y: cy - h / 2, w, h, scale, cx, cy };
}

/** Turn click clusters into zoom segments in source-pixel space. */
export function segmentsFromClicks(clicks, opts) {
  const {
    videoWidth,
    videoHeight,
    viewportWidth,
    viewportHeight,
    duration,
    gap = 3,
    padIn = 0.35,
    padOut = 1.1,
    maxZoom = 2.6,
    minZoom = 1.5,
  } = opts;

  if (!videoWidth || !videoHeight || !viewportWidth || !viewportHeight) return [];

  const sx = videoWidth / viewportWidth;
  const sy = videoHeight / viewportHeight;
  const clusters = clusterClicks(clicks, { gap });
  const segments = [];

  for (const cluster of clusters) {
    const pts = cluster.map((c) => ({ x: c.x * sx, y: c.y * sy }));
    const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
    const spread =
      pts.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length;

    const first = cluster[0].t;
    const last = cluster[cluster.length - 1].t;
    const depth = clamp(maxZoom - spread / 240, minZoom, maxZoom);

    segments.push({
      id: uid("z"),
      kind: "zoom",
      start: round2(clamp(first - padIn, 0, duration)),
      end: round2(clamp(last + padOut, 0, duration)),
      focus: { x: Math.round(clamp(cx, 0, videoWidth)), y: Math.round(clamp(cy, 0, videoHeight)) },
      depth: round2(depth),
      clicks: cluster.length,
      source: "auto",
    });
  }

  // Guarantee a visible window even for very short clips.
  for (const seg of segments) {
    if (seg.end - seg.start < 0.8) seg.end = clamp(seg.start + 0.8, 0, duration);
  }

  return mergeSegments(segments);
}

/** Overlapping zooms read as jitter, so fuse them. */
export function mergeSegments(segments) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const out = [];
  for (const seg of sorted) {
    const prev = out[out.length - 1];
    if (prev && seg.start <= prev.end - 0.05) {
      const prevClicks = prev.clicks || 1;
      const nextClicks = seg.clicks || 1;
      const total = prevClicks + nextClicks;
      prev.end = Math.max(prev.end, seg.end);
      prev.focus = {
        x: Math.round((prev.focus.x * prevClicks + seg.focus.x * nextClicks) / total),
        y: Math.round((prev.focus.y * prevClicks + seg.focus.y * nextClicks) / total),
      };
      prev.depth = Math.max(prev.depth, seg.depth);
      prev.clicks = total;
    } else {
      out.push({ ...seg, focus: { ...seg.focus } });
    }
  }
  return out;
}

/** Pixel size for the chosen aspect and resolution height. */
export function outputSize(output) {
  const h = Math.round(Number(output.height) || 1080);
  const ratios = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 };
  const ratio = ratios[output.aspect] || 16 / 9;
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(h * ratio), height: even(h) };
}
