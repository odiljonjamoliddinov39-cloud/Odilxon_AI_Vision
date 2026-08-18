import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
export class FrameSource {
  constructor({ rtspUrl, ffmpegPath, timeoutMs = 15000 }) {
    this.rtspUrl = rtspUrl;
    this.ffmpegPath = ffmpegPath;
    this.timeoutMs = timeoutMs;
  }
  snapshot() {
    return new Promise((resolve, reject) => {
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-rtsp_transport",
        "tcp",
        "-i",
        this.rtspUrl,
        "-an",
        "-frames:v",
        "1",
        "-q:v",
        "2",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
      ];
      const p = spawn(this.ffmpegPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const out = [],
        err = [];
      let settled = false;
      let timer;
      const done = (fn, v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(v);
      };
      p.stdout.on("data", (d) => out.push(d));
      p.stderr.on("data", (d) => err.push(d));
      p.on("error", (e) =>
        done(reject, new Error(`FFmpeg start failed: ${e.message}`)),
      );
      timer = setTimeout(() => {
        p.kill("SIGKILL");
        done(reject, new Error(`Snapshot timeout after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      p.on("close", (code) => {
        const jpg = Buffer.concat(out);
        if (code === 0 && jpg.length > 1000) return done(resolve, jpg);
        done(
          reject,
          new Error(
            `Snapshot failed (${code}): ${Buffer.concat(err).toString().slice(-1600)}`,
          ),
        );
      });
    });
  }
  async burst(count = 3, intervalMs = 650) {
    const frames = [];
    for (let i = 0; i < Math.max(1, count); i++) {
      frames.push({
        index: i,
        capturedAt: new Date().toISOString(),
        jpeg: await this.snapshot(),
      });
      if (i < count - 1) await sleep(intervalMs);
    }
    return frames;
  }
}
