import { saveSampledFrame } from "./frame-store.js";

export class FrameSampler {
  constructor({ source, camera, intervalMs, maxFrames, onError = console.error }) {
    this.source = source;
    this.camera = camera;
    this.intervalMs = Math.max(1000, intervalMs);
    this.maxFrames = maxFrames;
    this.onError = onError;
    this.timer = null;
    this.capturing = false;
  }

  async capture(trigger = "manual") {
    if (this.capturing) throw new Error("A sampled-frame capture is already in progress");
    this.capturing = true;
    try {
      const capturedAt = new Date().toISOString();
      const jpeg = await this.source.snapshot();
      return saveSampledFrame({ camera: this.camera, capturedAt, jpeg, trigger, maxFrames: this.maxFrames });
    } finally {
      this.capturing = false;
    }
  }

  start() {
    if (this.timer) return;
    const sample = () => this.capture("scheduled").catch(this.onError);
    this.timer = setInterval(sample, this.intervalMs);
    this.timer.unref();
    sample();
  }
}
