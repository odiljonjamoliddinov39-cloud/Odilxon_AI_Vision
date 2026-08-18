import { spawn } from "node:child_process";
import crypto from "node:crypto";

const START = Buffer.from([0xff, 0xd8]);
const END = Buffer.from([0xff, 0xd9]);

export function redactRtspCredentials(value) {
  return String(value || "").replace(/rtsp:\/\/[^\s/@]+@/gi, "rtsp://[credentials-redacted]@");
}

export class LiveSession {
  constructor({ channel, rtspUrl, ffmpegPath, onStateChange = () => {}, onNoClients = () => {} }) {
    this.id = `live_${crypto.randomUUID()}`;
    this.channel = channel;
    this.rtspUrl = rtspUrl;
    this.ffmpegPath = ffmpegPath;
    this.onStateChange = onStateChange;
    this.onNoClients = onNoClients;
    this.process = null;
    this.state = "starting";
    this.error = null;
    this.lastFailure = null;
    this.stderr = "";
    this.latestFrame = null;
    this.latestFrameAt = null;
    this.frameCount = 0;
    this.startedAt = new Date().toISOString();
    this.clients = new Set();
    this.buffer = Buffer.alloc(0);
    this.idleTimer = null;
  }

  start() {
    const args = [
      "-hide_banner", "-loglevel", "info", "-rtsp_transport", "tcp",
      "-i", this.rtspUrl, "-an", "-vf", "fps=5", "-q:v", "4",
      "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
    ];
    this.process = spawn(this.ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    this.process.stdout.on("data", (chunk) => this.consume(chunk));
    this.process.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-12000);
    });
    this.process.on("error", (error) => this.fail(`FFmpeg start failed: ${error.message}`));
    this.process.on("close", (code, signal) => {
      if (this.state === "stopped") return;
      const detail = this.stderr.trim().slice(-4000);
      this.fail(`FFmpeg exited (code ${code}, signal ${signal || "none"})${detail ? `: ${detail}` : ""}`);
    });
    return this;
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const start = this.buffer.indexOf(START);
      if (start < 0) {
        this.buffer = this.buffer.slice(-1);
        return;
      }
      const end = this.buffer.indexOf(END, start + 2);
      if (end < 0) {
        if (start > 0) this.buffer = this.buffer.slice(start);
        return;
      }
      const frame = Buffer.from(this.buffer.subarray(start, end + 2));
      this.buffer = this.buffer.subarray(end + 2);
      this.latestFrame = frame;
      this.latestFrameAt = new Date().toISOString();
      this.frameCount += 1;
      this.state = "online";
      this.error = null;
      this.onStateChange(this);
      this.broadcast(frame);
    }
  }

  broadcast(frame) {
    const header = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;
    for (const response of this.clients) {
      try { response.write(header); response.write(frame); response.write("\r\n"); }
      catch { this.clients.delete(response); }
    }
  }

  subscribe(response) {
    clearTimeout(this.idleTimer);
    response.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Connection: "keep-alive",
    });
    this.clients.add(response);
    if (this.latestFrame) this.broadcastTo(response, this.latestFrame);
    response.on("close", () => {
      this.clients.delete(response);
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        if (this.clients.size === 0) this.onNoClients(this);
      }, 5000);
      this.idleTimer.unref();
    });
  }

  broadcastTo(response, frame) {
    response.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
    response.write(frame);
    response.write("\r\n");
  }

  fail(message) {
    this.state = "error";
    this.error = redactRtspCredentials(message);
    this.lastFailure = this.error;
    this.onStateChange(this);
    for (const response of this.clients) response.end();
    this.clients.clear();
  }

  stop(reason = "closed") {
    if (this.state === "stopped") return;
    this.state = "stopped";
    clearTimeout(this.idleTimer);
    this.error = this.lastFailure || reason;
    for (const response of this.clients) response.end();
    this.clients.clear();
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
      const process = this.process;
      const timer = setTimeout(() => { if (!process.killed) process.kill("SIGKILL"); }, 1500);
      timer.unref();
    }
    this.onStateChange(this);
  }

  status() {
    return {
      id: this.id,
      channelId: this.channel.id,
      rtspChannel: this.channel.rtspChannel || this.channel.id,
      channelName: this.channel.name,
      state: this.state,
      startedAt: this.startedAt,
      latestFrameAt: this.latestFrameAt,
      frameCount: this.frameCount,
      clients: this.clients.size,
      error: this.error,
      technicalReason: this.lastFailure,
      ffmpegLog: redactRtspCredentials(this.stderr.trim().slice(-4000)) || null,
    };
  }
}

export class LiveSessionManager {
  constructor(options) { this.options = options; this.active = null; }
  open({ channel, rtspUrl }) {
    this.close("another camera opened");
    const session = new LiveSession({
      ...this.options,
      channel,
      rtspUrl,
      onNoClients: () => {
        if (this.active?.id === session.id) this.close("live preview disconnected");
      },
    });
    this.active = session.start();
    return this.active;
  }
  get(id) { return this.active?.id === id ? this.active : null; }
  close(reason = "workspace closed") {
    if (!this.active) return;
    this.active.stop(reason);
    this.active = null;
  }
}
