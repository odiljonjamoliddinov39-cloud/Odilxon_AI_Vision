import express from "express";
import path from "node:path";
import { loadConfig, buildRtspUrl, sanitizeRtspUrl } from "./config.js";
import { resolveFfmpeg } from "./ffmpeg.js";
import { FrameSource } from "./frame-source.js";
import { createVisionEngine, listVisionEngines, normalizeVisionResult } from "./vision/index.js";
import { getAnalysisFrame, listAnalysisFrames, saveAnalysisFrame } from "./capture-store.js";
import { LiveSessionManager } from "./live-session.js";

const cfg = loadConfig();
const ffmpegPath = resolveFfmpeg();
const visionEngine = await createVisionEngine(cfg.vision.engine, cfg.vision.engines?.[cfg.vision.engine] || {});
const channelStates = new Map(cfg.channels.map((channel) => [channel.id, "offline"]));
const channelDiagnostics = new Map();
const liveSessions = new LiveSessionManager({
  ffmpegPath,
  onStateChange: (session) => {
    channelStates.set(session.channel.id, session.state === "online" ? "online" : "offline");
    channelDiagnostics.set(session.channel.id, session.status());
  },
});

function getChannel(id) {
  const channel = cfg.channels.find((candidate) => candidate.id === Number(id) && candidate.enabled);
  if (!channel) throw Object.assign(new Error("NVR channel not found"), { status: 404 });
  return channel;
}

function sourceFor(channel) {
  return new FrameSource({
    rtspUrl: buildRtspUrl(cfg.nvr, channel),
    ffmpegPath,
    timeoutMs: cfg.nvr.timeoutMs,
  });
}

async function snapshot(channel) {
  try {
    const jpeg = await sourceFor(channel).snapshot();
    channelStates.set(channel.id, "online");
    return jpeg;
  } catch (error) {
    channelStates.set(channel.id, "offline");
    throw error;
  }
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));
app.use("/analysis-frames", express.static(path.resolve("analysis-frames")));

app.get("/api/health", (req, res) => res.json({
  ok: true,
  nvr: cfg.nvr.name,
  channels: cfg.channels.length,
  vision: {
    engine: cfg.vision.engine,
    engines: listVisionEngines(),
    threshold: cfg.vision.threshold,
    info: typeof visionEngine.info === "function" ? visionEngine.info() : null,
  },
  samplingEnabled: false,
  ffmpegPath,
}));

app.get("/api/channels", (req, res) => res.json(cfg.channels.filter((channel) => channel.enabled).map((channel) => ({
  id: channel.id,
  rtspChannel: channel.rtspChannel,
  name: channel.name,
  state: channelStates.get(channel.id) || "offline",
  previewUrl: `/api/channels/${channel.id}/preview.jpg`,
}))));

app.get("/api/channels/:id/preview.jpg", async (req, res) => {
  try {
    const jpeg = await snapshot(getChannel(req.params.id));
    res.set("Cache-Control", "no-store").type("jpeg").send(jpeg);
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.post("/api/channels/:id/live", (req, res) => {
  try {
    const channel = getChannel(req.params.id);
    const session = liveSessions.open({ channel, rtspUrl: buildRtspUrl(cfg.nvr, channel) });
    channelDiagnostics.set(channel.id, session.status());
    res.status(201).json({
      ...session.status(),
      streamUrl: `/api/live/${session.id}/stream.mjpg`,
      statusUrl: `/api/live/${session.id}`,
    });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.get("/api/live/:sessionId/stream.mjpg", (req, res) => {
  const session = liveSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Live session not found" });
  session.subscribe(res);
});

app.get("/api/live/:sessionId", (req, res) => {
  const session = liveSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Live session not found" });
  res.json(session.status());
});

app.post("/api/live/:sessionId/captures", (req, res) => {
  const session = liveSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Live session not found" });
  if (!session.latestFrame) return res.status(409).json({
    error: "No decoded live frame is available yet.",
    diagnostics: session.status(),
  });
  const frame = saveAnalysisFrame({
    channel: session.channel,
    jpeg: Buffer.from(session.latestFrame),
    capturedAt: session.latestFrameAt,
  });
  res.status(201).json(frame);
});

app.delete("/api/live/:sessionId", (req, res) => {
  const session = liveSessions.get(req.params.sessionId);
  if (session) liveSessions.close("workspace closed");
  res.status(204).end();
});

app.post("/api/live/:sessionId/close", (req, res) => {
  const session = liveSessions.get(req.params.sessionId);
  if (session) liveSessions.close("workspace closed");
  res.status(204).end();
});

app.get("/api/channels/:id/diagnostics", (req, res) => {
  try {
    const channel = getChannel(req.params.id);
    const mainUrl = buildRtspUrl(cfg.nvr, { ...channel, stream: "main" });
    const subUrl = buildRtspUrl(cfg.nvr, { ...channel, stream: "sub" });
    res.json({
      channelId: channel.id,
      rtspChannel: channel.rtspChannel,
      generatedUrls: {
        main: sanitizeRtspUrl(mainUrl),
        sub: sanitizeRtspUrl(subUrl),
      },
      expectedChannelCodes: { main: `${channel.rtspChannel}01`, sub: `${channel.rtspChannel}02` },
      live: channelDiagnostics.get(channel.id) || null,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get("/api/analysis-frames", (req, res) => res.json(listAnalysisFrames(Number(req.query.limit) || 30, req.query.channelId)));
app.get("/api/analysis-frames/:id", (req, res) => {
  const frame = getAnalysisFrame(req.params.id);
  if (!frame) return res.status(404).json({ error: "Analysis frame not found" });
  const { filePath, ...metadata } = frame;
  res.json(metadata);
});

app.post("/api/analyze", async (req, res) => {
  try {
    const frame = getAnalysisFrame(req.body.frameId);
    if (!frame) return res.status(404).json({ error: "Capture a frame before analysis." });

    const result = await visionEngine.analyze({
      frame,
      instruction: {
        target: req.body.target,
        threshold: req.body.threshold ?? cfg.vision.threshold,
        task: req.body.task || "inspect",
        options: req.body.options || {},
      },
      debug: req.body.debug === true || cfg.vision.debug,
    });

    res.json(normalizeVisionResult(result));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.listen(cfg.port, () => {
  console.log(`Vision JS NVR: http://localhost:${cfg.port}`);
  console.log(`NVR: ${cfg.nvr.name} (${cfg.channels.length} configured channels)`);
  console.log(`Vision engine: ${cfg.vision.engine}; available: ${listVisionEngines().join(", ")}`);
  console.log(`FFmpeg: ${ffmpegPath}`);
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    liveSessions.close(`server received ${signal}`);
    process.exit(0);
  });
}
process.once("exit", () => liveSessions.close("server exiting"));
