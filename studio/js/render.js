/* Canvas renderer. One function draws a project at time t, used by both the
   live preview and the exporter so they cannot drift apart. */

import { cameraAt } from "./zoom.js";

function coverRect(src, targetAspect) {
  const srcAspect = src.w / src.h;
  if (srcAspect > targetAspect) {
    const w = src.h * targetAspect;
    return { x: src.x + (src.w - w) / 2, y: src.y, w, h: src.h };
  }
  const h = src.w / targetAspect;
  return { x: src.x, y: src.y + (src.h - h) / 2, w: src.w, h };
}

function containBox(box, aspect) {
  let w = box.w;
  let h = w / aspect;
  if (h > box.h) {
    h = box.h;
    w = h * aspect;
  }
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function roundPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawWallpaper(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#e9f7ef");
  g.addColorStop(0.45, "#e6eefc");
  g.addColorStop(1, "#ecfdf5");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.5, H * 0.15, 0, W * 0.5, H * 0.15, Math.max(W, H) * 0.7);
  glow.addColorStop(0, "rgba(255,255,255,.65)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function drawChromeBar(ctx, box, radius, scale) {
  ctx.save();
  roundPath(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.clip();
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(box.x, box.y, box.w, box.h);

  const pad = Math.round(box.h * 0.36);
  const dotR = Math.max(2, Math.round(box.h * 0.11));
  const dots = ["#fca5a5", "#fcd34d", "#86efac"];
  dots.forEach((color, i) => {
    ctx.beginPath();
    ctx.arc(box.x + pad + i * dotR * 3.2, box.y + box.h / 2, dotR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  const pillX = box.x + pad + dotR * 9;
  const pillW = Math.min(box.w * 0.44, box.w - (pillX - box.x) - pad);
  if (pillW > 10) {
    const pillH = Math.round(box.h * 0.42);
    roundPath(ctx, pillX, box.y + (box.h - pillH) / 2, pillW, pillH, pillH / 2);
    ctx.fillStyle = "#eef2f6";
    ctx.fill();
    ctx.fillStyle = "#c7d2de";
    ctx.font = `600 ${Math.round(box.h * 0.32)}px "Plus Jakarta Sans", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText("cursorful.com/share/demo", pillX + pillH * 0.7, box.y + box.h / 2 + 1);
  }

  ctx.fillStyle = "rgba(15,23,42,.07)";
  ctx.fillRect(box.x, box.y + box.h - 1, box.w, Math.max(1, Math.round(scale)));
  ctx.restore();
}

function drawWebcam(ctx, camVideo, box, shape) {
  if (!camVideo || !camVideo.videoWidth) return;
  const radius = shape === "circle" ? box.w / 2 : shape === "rounded" ? box.w * 0.16 : box.w * 0.04;

  ctx.save();
  if (shape === "circle") {
    ctx.beginPath();
    ctx.arc(box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) / 2, 0, Math.PI * 2);
  } else {
    roundPath(ctx, box.x, box.y, box.w, box.h, radius);
  }
  ctx.clip();

  const cw = camVideo.videoWidth;
  const ch = camVideo.videoHeight;
  const src = coverRect({ x: 0, y: 0, w: cw, h: ch }, box.w / box.h);
  ctx.drawImage(camVideo, src.x, src.y, src.w, src.h, box.x, box.y, box.w, box.h);
  ctx.restore();

  ctx.save();
  ctx.lineWidth = Math.max(2, box.w * 0.018);
  ctx.strokeStyle = "rgba(255,255,255,.92)";
  if (shape === "circle") {
    ctx.beginPath();
    ctx.arc(box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) / 2, 0, Math.PI * 2);
  } else {
    roundPath(ctx, box.x, box.y, box.w, box.h, radius);
  }
  ctx.stroke();
  ctx.restore();
}

function placeholder(ctx, W, H) {
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,.35)";
  ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Preparing frames", W / 2, H / 2);
  ctx.textAlign = "start";
}

/**
 * Draw one frame.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{video: HTMLVideoElement, camVideo: HTMLVideoElement|null, project: object, t: number}} opts
 */
export function drawFrame(ctx, { video, camVideo, project, t }) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const style = project.style || {};
  const scale = Math.min(W, H) / 1080;

  ctx.clearRect(0, 0, W, H);

  const wallpaper = style.background === "wallpaper";
  if (wallpaper) drawWallpaper(ctx, W, H);
  else {
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, W, H);
  }

  if (!video || !video.videoWidth || !video.videoHeight) {
    if (!wallpaper) placeholder(ctx, W, H);
    return;
  }

  const sw = video.videoWidth;
  const sh = video.videoHeight;
  const crop = project.crop || { x: 0, y: 0, w: 1, h: 1 };
  const srcRect = { x: crop.x * sw, y: crop.y * sh, w: crop.w * sw, h: crop.h * sh };

  const pad = wallpaper ? Math.round(Math.min(W, H) * 0.055) : 0;
  const card = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 };
  const corner = wallpaper ? Math.round(16 * scale) : 0;

  const camMode = style.cam?.layout || "off";
  const barH = style.frame === "minimal" ? Math.max(18, Math.round(card.h * 0.058)) : 0;

  const content = { x: card.x, y: card.y + barH, w: card.w, h: card.h - barH };

  let camBox = null;
  if (camMode === "side") {
    const camW = Math.round(content.w * 0.26);
    const gap = Math.round(content.w * 0.022);
    const camH = Math.min(content.h, Math.round(camW * 1.25));
    camBox = {
      x: content.x + content.w - camW,
      y: content.y + Math.round((content.h - camH) / 2),
      w: camW,
      h: camH,
    };
    content.w -= camW + gap;
  }

  // Card background so letterboxed content sits on white.
  if (wallpaper) {
    ctx.save();
    ctx.fillStyle = "rgba(15,23,42,.10)";
    roundPath(ctx, card.x + 2, card.y + 4, card.w, card.h, corner);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    roundPath(ctx, card.x, card.y, card.w, card.h, corner);
    ctx.fill();
    ctx.restore();
  }

  const aspect = content.w / content.h;
  const srcAspect = srcRect.w / srcRect.h;

  let dest;
  let base;
  if (wallpaper) {
    // Show the whole frame, letterboxed on the card.
    dest = containBox(content, srcAspect);
    base = { ...srcRect };
  } else {
    dest = { ...content };
    base = coverRect(srcRect, aspect);
  }

  const camera = cameraAt(project.timeline || [], t, base);
  const contentRadius = wallpaper ? Math.max(0, corner - Math.round(barH / 2)) : 0;

  ctx.save();
  if (contentRadius > 0) {
    roundPath(ctx, dest.x, dest.y, dest.w, dest.h, contentRadius);
    ctx.clip();
  }
  ctx.drawImage(video, camera.x, camera.y, camera.w, camera.h, dest.x, dest.y, dest.w, dest.h);
  ctx.restore();

  if (barH > 0) drawChromeBar(ctx, { x: card.x, y: card.y, w: card.w, h: barH }, corner, scale);

  if (camMode === "overlay") {
    const size = Math.min(content.w, content.h) * ((style.cam?.size || 18) / 100);
    const margin = size * 0.14;
    camBox = {
      x: content.x + content.w - size - margin,
      y: content.y + content.h - size - margin,
      w: size,
      h: size,
    };
  }

  if (camBox && camMode !== "off") {
    drawWebcam(ctx, camVideo, camBox, style.cam?.shape || "circle");
  }

  if (wallpaper) {
    ctx.save();
    ctx.strokeStyle = "rgba(15,23,42,.10)";
    ctx.lineWidth = Math.max(1, scale);
    roundPath(ctx, card.x, card.y, card.w, card.h, corner);
    ctx.stroke();
    ctx.restore();
  }
}
