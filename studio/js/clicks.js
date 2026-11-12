/* Click telemetry: clustering and deterministic sample data.
   Pure functions, no DOM. */

/** Group clicks into bursts where each click is within `gap` seconds of the previous. */
export function clusterClicks(clicks, { gap = 3, minClicks = 2 } = {}) {
  const sorted = [...clicks].filter((c) => Number.isFinite(c.t)).sort((a, b) => a.t - b.t);
  const clusters = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].t - sorted[j].t <= gap) j += 1;
    if (j - i + 1 >= minClicks) clusters.push(sorted.slice(i, j + 1));
    i = j + 1;
  }
  return clusters;
}

/** A scripted click log so the engine can be demonstrated without the extension. */
export function sampleClicks(duration = 12, viewport = { width: 1440, height: 900 }) {
  const { width: vw, height: vh } = viewport;
  const at = (t, x, y) => ({ t, x: Math.round(x * vw), y: Math.round(y * vh) });
  const cap = Math.max(2, duration - 1.2);

  const clicks = [
    at(1.4, 0.34, 0.42),
    at(1.85, 0.37, 0.45),
    at(2.3, 0.35, 0.48),
    at(5.1, 0.68, 0.3),
    at(5.6, 0.71, 0.33),
    at(8.7, 0.29, 0.68),
    at(9.15, 0.32, 0.71),
    at(9.55, 0.3, 0.74),
  ].filter((c) => c.t < cap);

  return clicks;
}

/** Normalize a stored click record from the extension or an imported JSON log. */
export function normalizeClicks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => ({
      x: Number(c.x),
      y: Number(c.y),
      t: Number(c.t),
      w: Number(c.w) || 0,
      h: Number(c.h) || 0,
    }))
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.t));
}
