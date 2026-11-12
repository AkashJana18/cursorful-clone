/* Synthetic clip generator.
   Lets the editor be exercised end to end without a screen recording. */

import { bestVideoOnlyMime } from "./capture.js";

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawDemoFrame(ctx, W, H, t) {
  ctx.fillStyle = "#eaf3ed";
  ctx.fillRect(0, 0, W, H);

  // window
  const pad = Math.round(W * 0.035);
  const win = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 };
  ctx.save();
  ctx.fillStyle = "rgba(15,23,42,.10)";
  roundRect(ctx, win.x + 2, win.y + 6, win.w, win.h, 16);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, win.x, win.y, win.w, win.h, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(15,23,42,.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // chrome bar
  const barH = Math.round(win.h * 0.062);
  ctx.save();
  roundRect(ctx, win.x, win.y, win.w, win.h, 16);
  ctx.clip();
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(win.x, win.y, win.w, barH);
  ctx.fillStyle = "rgba(15,23,42,.08)";
  ctx.fillRect(win.x, win.y + barH - 1, win.w, 1);
  ["#fca5a5", "#fcd34d", "#86efac"].forEach((color, i) => {
    ctx.beginPath();
    ctx.arc(win.x + 22 + i * 16, win.y + barH / 2, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
  roundRect(ctx, win.x + 82, win.y + barH * 0.26, win.w * 0.34, barH * 0.48, barH * 0.24);
  ctx.fillStyle = "#eef2f6";
  ctx.fill();
  ctx.restore();

  const bodyY = win.y + barH;
  const bodyH = win.h - barH;
  const sideW = Math.round(win.w * 0.17);

  // sidebar
  ctx.save();
  ctx.fillStyle = "#fbfdfc";
  ctx.fillRect(win.x, bodyY, sideW, bodyH);
  ctx.fillStyle = "rgba(15,23,42,.06)";
  ctx.fillRect(win.x + sideW, bodyY, 1, bodyH);
  for (let i = 0; i < 7; i += 1) {
    const rowY = bodyY + 26 + i * 34;
    const active = i === 1;
    if (active) {
      roundRect(ctx, win.x + 12, rowY - 8, sideW - 24, 26, 7);
      ctx.fillStyle = "#dcfce7";
      ctx.fill();
    }
    roundRect(ctx, win.x + 20, rowY - 3, 10, 10, 3);
    ctx.fillStyle = active ? "#22c55e" : "#dbe4df";
    ctx.fill();
    roundRect(ctx, win.x + 38, rowY - 2, sideW * (0.34 + (i % 3) * 0.1), 7, 3.5);
    ctx.fillStyle = active ? "#86efac" : "#e8eeea";
    ctx.fill();
  }
  ctx.restore();

  // main
  const mx = win.x + sideW + 30;
  const mw = win.w - sideW - 30 - 30;
  ctx.fillStyle = "#0f172a";
  ctx.font = '800 26px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText("Reports", mx, bodyY + 48);
  ctx.fillStyle = "#94a3b8";
  ctx.font = '500 13px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText("Growth and engagement across your workspace", mx, bodyY + 68);

  // stat cards
  const cardW = (mw - 24) / 3;
  const cardY = bodyY + 88;
  const cardH = Math.round(bodyH * 0.19);
  const stats = [
    ["Page views", "3,210", "+12.4%"],
    ["Unique visitors", "9,804", "+6.1%"],
    ["Avg. session", "4m 12s", "+0.8%"],
  ];
  stats.forEach(([label, value, delta], i) => {
    const x = mx + i * (cardW + 12);
    roundRect(ctx, x, cardY, cardW, cardH, 12);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#e8eeea";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    ctx.font = '600 11px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(label, x + 14, cardY + 22);
    ctx.fillStyle = "#0f172a";
    ctx.font = '800 22px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(value, x + 14, cardY + 48);
    ctx.fillStyle = "#16a34a";
    ctx.font = '700 10px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(delta, x + cardW - 46, cardY + 48);
  });

  // chart
  const chartY = cardY + cardH + 28;
  const chartH = bodyY + bodyH - chartY - 30;
  ctx.fillStyle = "#475569";
  ctx.font = '700 12px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText("Monthly views", mx, chartY);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = '500 10px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText("Last 30 days", mx, chartY + 13);

  const bars = 16;
  const gap = 9;
  const bw = (mw - gap * (bars - 1)) / bars;
  const base = chartY + chartH;
  for (let i = 0; i < bars; i += 1) {
    const wave = 0.5 + 0.5 * Math.sin(t * 2.2 + i * 0.7);
    const h = chartH * (0.16 + wave * 0.72) * (i > 11 ? 0.55 : 1);
    const x = mx + i * (bw + gap);
    roundRect(ctx, x, base - h, bw, h, 3);
    ctx.fillStyle = i % 3 === 0 ? "#4ade80" : "#a7f3c9";
    ctx.fill();
  }

  // cursor with a small trailing path
  const waypoints = [
    [0.28, 0.34],
    [0.46, 0.52],
    [0.63, 0.3],
    [0.4, 0.7],
    [0.72, 0.6],
  ];
  const cycle = (((t / 3) % 1) + 1) % 1;
  const idx = Math.max(0, Math.min(waypoints.length - 2, Math.floor(cycle * (waypoints.length - 1))));
  const span = 1 / (waypoints.length - 1);
  const local = Math.max(0, Math.min(1, (cycle - idx * span) / span));
  const a = waypoints[idx];
  const b = waypoints[idx + 1];
  const ease = local * local * (3 - 2 * local);
  const cx = mx + mw * (a[0] + (b[0] - a[0]) * ease);
  const cy = bodyY + bodyH * (a[1] + (b[1] - a[1]) * ease);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 19);
  ctx.lineTo(5, 14.5);
  ctx.lineTo(9, 22);
  ctx.lineTo(12, 20.4);
  ctx.lineTo(8, 13);
  ctx.lineTo(14, 12.4);
  ctx.closePath();
  ctx.fillStyle = "#111827";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();

  // click ripple
  const clickPhase = (t % 3) / 3;
  if (clickPhase < 0.3) {
    const r = 8 + clickPhase * 70;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(34,197,94,${0.55 * (1 - clickPhase / 0.3)})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

export async function generateDemoClip({ seconds = 6, width = 1280, height = 720, onProgress } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const stream = canvas.captureStream(30);
  const mime = bestVideoOnlyMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5_000_000 } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  const done = new Promise((resolve) => {
    recorder.addEventListener("stop", resolve, { once: true });
  });
  recorder.start(250);

  const started = performance.now();
  await new Promise((resolve) => {
    const tick = (now) => {
      const t = Math.max(0, (now - started) / 1000);
      drawDemoFrame(ctx, width, height, t);
      if (onProgress) onProgress(Math.min(1, t / seconds));
      if (t >= seconds) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  recorder.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());

  return new Blob(chunks, { type: (recorder.mimeType || "video/webm").split(";")[0] });
}
