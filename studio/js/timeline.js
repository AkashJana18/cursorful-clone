/* Timeline: ruler, lane, draggable zoom segments, playhead. */

const MIN_SEG = 0.3;
const SNAP = 0.05;

function snap(v) {
  return Math.round(v / SNAP) * SNAP;
}

function fmt(t, forceMinutes = false) {
  const total = Math.max(0, t);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const ss = s.toFixed(s < 10 ? 1 : 1);
  if (m > 0 || forceMinutes) return `${m}:${s < 10 ? "0" : ""}${ss}`;
  return `${s.toFixed(1)}s`;
}

function niceStep(duration) {
  const target = duration / 9;
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s >= target) || 600;
}

export class Timeline {
  constructor({ ruler, lane, playhead, body, empty, onSeek, onSelect, onChange, onLive, onCreate }) {
    this.ruler = ruler;
    this.lane = lane;
    this.playhead = playhead;
    this.body = body;
    this.empty = empty;
    this.onSeek = onSeek || (() => {});
    this.onSelect = onSelect || (() => {});
    this.onChange = onChange || (() => {});
    this.onLive = onLive || (() => {});
    this.onCreate = onCreate || (() => {});

    this.duration = 0;
    this.segments = [];
    this.selected = null;
    this.time = 0;
    this.drag = null;

    this.bind();
  }

  bind() {
    this.ruler.addEventListener("pointerdown", (e) => {
      if (!this.duration) return;
      const rect = this.body.getBoundingClientRect();
      const t = ((e.clientX - rect.left) / rect.width) * this.duration;
      this.onSeek(Math.max(0, Math.min(this.duration, t)));
    });

    this.lane.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".zseg")) return;
      if (!this.duration) return;
      const rect = this.body.getBoundingClientRect();
      const t = ((e.clientX - rect.left) / rect.width) * this.duration;
      this.onSelect(null);
      this.onSeek(Math.max(0, Math.min(this.duration, t)));
    });

    this.lane.addEventListener("dblclick", (e) => {
      if (e.target.closest(".zseg")) return;
      if (!this.duration) return;
      const rect = this.body.getBoundingClientRect();
      const t = ((e.clientX - rect.left) / rect.width) * this.duration;
      this.onCreate(t);
    });

    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
  }

  startDrag(e, seg) {
    const handle = e.target.closest(".zseg__handle");
    const mode = handle ? (handle.classList.contains("zseg__handle--l") ? "left" : "right") : "move";
    const rect = this.body.getBoundingClientRect();
    this.drag = {
      id: seg.id,
      mode,
      startX: e.clientX,
      rectWidth: rect.width,
      startStart: seg.start,
      startEnd: seg.end,
    };
    this.onSelect(seg.id);
    e.preventDefault();
    e.stopPropagation();
  }

  onPointerMove(e) {
    if (!this.drag || !this.duration) return;
    const seg = this.segments.find((s) => s.id === this.drag.id);
    if (!seg) return;

    const dt = ((e.clientX - this.drag.startX) / this.drag.rectWidth) * this.duration;
    const { mode, startStart, startEnd } = this.drag;

    if (mode === "move") {
      const span = startEnd - startStart;
      const next = Math.max(0, Math.min(this.duration - span, snap(startStart + dt)));
      seg.start = next;
      seg.end = next + span;
    } else if (mode === "left") {
      seg.start = Math.max(0, Math.min(startEnd - MIN_SEG, snap(startStart + dt)));
      seg.end = startEnd;
    } else {
      seg.end = Math.min(this.duration, Math.max(startStart + MIN_SEG, snap(startEnd + dt)));
      seg.start = startStart;
    }

    this.render();
    this.onLive();
  }

  onPointerUp() {
    if (!this.drag) return;
    this.drag = null;
    this.onChange();
  }

  setDuration(duration) {
    const safe = Number.isFinite(duration) && duration > 0 ? duration : 0;
    this.duration = safe;
    this.render();
  }

  setSegments(segments) {
    this.segments = segments || [];
    this.render();
  }

  setSelected(id) {
    this.selected = id;
    this.render();
  }

  setTime(t) {
    this.time = t;
    if (this.duration > 0) {
      const pct = (t / this.duration) * 100;
      this.playhead.style.left = `${pct}%`;
    }
  }

  render() {
    this.renderRuler();
    this.renderLane();
    this.setTime(this.time);
  }

  renderRuler() {
    this.ruler.textContent = "";
    if (!this.duration || !Number.isFinite(this.duration)) return;
    const step = niceStep(this.duration);
    if (!Number.isFinite(step) || step <= 0) return;
    const frag = document.createDocumentFragment();
    for (let t = 0, guard = 0; t <= this.duration + 1e-6 && guard < 400; t += step, guard += 1) {
      const pct = (t / this.duration) * 100;
      const tick = document.createElement("span");
      tick.className = "tl__tick tl__tick--major";
      tick.style.left = `${pct}%`;
      frag.appendChild(tick);

      const label = document.createElement("span");
      label.className = "tl__tickLabel";
      label.style.left = `${pct}%`;
      label.textContent = fmt(t, true);
      frag.appendChild(label);
    }
    this.ruler.appendChild(frag);
  }

  renderLane() {
    this.lane.textContent = "";
    const count = this.segments.length;
    this.empty.hidden = count > 0;
    if (count === 0) {
      this.lane.appendChild(this.empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const seg of this.segments) {
      const left = (seg.start / this.duration) * 100;
      const width = ((seg.end - seg.start) / this.duration) * 100;
      const el = document.createElement("div");
      el.className = "zseg" + (seg.id === this.selected ? " is-sel" : "");
      el.style.left = `${left}%`;
      el.style.width = `${Math.max(width, 0.6)}%`;
      el.dataset.id = seg.id;
      el.title = `Zoom ${seg.depth.toFixed(2)}x at ${fmt(seg.start)} to ${fmt(seg.end)}`;
      el.innerHTML = `
        <span class="zseg__handle zseg__handle--l"></span>
        <span class="zseg__label"><svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="5" cy="5" r="3.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7.4 7.4L10 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>${seg.depth.toFixed(1)}x</span>
        <span class="zseg__handle zseg__handle--r"></span>`;
      el.addEventListener("pointerdown", (e) => this.startDrag(e, seg));
      frag.appendChild(el);
    }
    this.lane.appendChild(frag);
  }
}
