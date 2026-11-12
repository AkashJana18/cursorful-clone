/* Screen, microphone, and camera capture.
   Records the raw streams; the editor re-renders them through the canvas. */

export function bestRecordingMime() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
}

export function bestVideoOnlyMime() {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
}

export class ScreenCapture {
  constructor({ onDisplayEnded } = {}) {
    this.recorder = null;
    this.camRecorder = null;
    this.display = null;
    this.mic = null;
    this.cam = null;
    this.audioCtx = null;
    this.chunks = [];
    this.camChunks = [];
    this.startedAt = 0;
    this.startedPerf = 0;
    this.mime = "";
    this.camMime = "";
    this.width = 0;
    this.height = 0;
    this.onDisplayEnded = onDisplayEnded;
  }

  get active() {
    return Boolean(this.recorder && this.recorder.state === "recording");
  }

  get elapsed() {
    return this.startedPerf ? (performance.now() - this.startedPerf) / 1000 : 0;
  }

  async start({ tabAudio = true, mic = false, cam = false, fps = 30 } = {}) {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("This browser has no screen capture API. Use Chrome, Edge, or Safari on a desktop.");
    }

    this.display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps, max: fps } },
      audio: tabAudio,
    });

    const track = this.display.getVideoTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    this.width = settings.width || 1280;
    this.height = settings.height || 720;

    if (mic) {
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (err) {
        this.stopTracks();
        throw new Error(`Microphone permission failed: ${err.message}`);
      }
    }

    if (cam) {
      try {
        this.cam = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: 30 },
        });
      } catch (err) {
        this.stopTracks();
        throw new Error(`Camera permission failed: ${err.message}`);
      }
    }

    const audioTracks = await this.mixAudio(this.display, this.mic);
    const stream = new MediaStream([...this.display.getVideoTracks(), ...audioTracks]);

    this.mime = bestRecordingMime();
    this.chunks = [];
    this.recorder = new MediaRecorder(
      stream,
      this.mime ? { mimeType: this.mime, videoBitsPerSecond: 8_000_000 } : undefined
    );
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.recorder.start(400);

    if (this.cam) {
      this.camMime = bestVideoOnlyMime();
      this.camChunks = [];
      this.camRecorder = new MediaRecorder(
        this.cam,
        this.camMime ? { mimeType: this.camMime, videoBitsPerSecond: 2_500_000 } : undefined
      );
      this.camRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size) this.camChunks.push(e.data);
      };
      this.camRecorder.start(400);
    }

    track.addEventListener("ended", () => {
      if (this.onDisplayEnded) this.onDisplayEnded();
    });

    this.startedAt = Date.now();
    this.startedPerf = performance.now();
    return { width: this.width, height: this.height, hasAudio: audioTracks.length > 0 };
  }

  async mixAudio(display, mic) {
    const tabTracks = display.getAudioTracks();
    if (tabTracks.length === 0 && !mic) return [];

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return tabTracks;

    this.audioCtx = new Ctx();
    const dest = this.audioCtx.createMediaStreamDestination();

    if (tabTracks.length) {
      const node = this.audioCtx.createMediaStreamSource(new MediaStream(tabTracks));
      node.connect(dest);
    }
    if (mic) {
      const node = this.audioCtx.createMediaStreamSource(mic);
      node.connect(dest);
    }

    try { await this.audioCtx.resume(); } catch { /* ignore */ }
    return dest.stream.getAudioTracks();
  }

  async stop() {
    const duration = this.elapsed;

    const stopRecorder = (rec) =>
      new Promise((resolve) => {
        if (!rec || rec.state === "inactive") return resolve();
        rec.addEventListener("stop", () => resolve(), { once: true });
        rec.stop();
      });

    await Promise.all([stopRecorder(this.recorder), stopRecorder(this.camRecorder)]);

    const videoBlob = this.chunks.length
      ? new Blob(this.chunks, { type: (this.recorder.mimeType || "video/webm").split(";")[0] })
      : null;
    const camBlob = this.camChunks.length
      ? new Blob(this.camChunks, { type: (this.camRecorder.mimeType || "video/webm").split(";")[0] })
      : null;

    this.stopTracks();

    return {
      videoBlob,
      camBlob,
      duration: Math.max(0.2, duration),
      width: this.width,
      height: this.height,
      startedAt: this.startedAt,
    };
  }

  stopTracks() {
    [this.display, this.mic, this.cam].forEach((stream) => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    });
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      this.audioCtx.close().catch(() => {});
    }
    this.display = null;
    this.mic = null;
    this.cam = null;
    this.audioCtx = null;
    this.recorder = null;
    this.camRecorder = null;
  }
}
