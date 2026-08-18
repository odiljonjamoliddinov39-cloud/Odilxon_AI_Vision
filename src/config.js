import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = process.env.VISION_CONFIG || path.resolve("config.json");

function defaultChannels(count = 24) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Channel ${index + 1}`,
    enabled: true,
    stream: "main",
  }));
}

export function buildRtspUrl(nvr, channel) {
  const streamCode = channel.stream === "sub" ? "02" : "01";
  const nvrChannel = Number(channel.rtspChannel || channel.id);
  const channelCode = `${nvrChannel}${streamCode}`;
  const pathname = (nvr.pathTemplate || "/Streaming/Channels/{channelCode}")
    .replace("{channel}", String(nvrChannel))
    .replace("{channelCode}", channelCode);
  const credentials = nvr.username
    ? `${encodeURIComponent(nvr.username)}:${encodeURIComponent(nvr.password || "")}@`
    : "";
  return `rtsp://${credentials}${nvr.host}:${nvr.port || 554}${pathname}`;
}

export function sanitizeRtspUrl(value) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  return url.toString();
}

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH))
    throw new Error(`Missing ${CONFIG_PATH}. Copy config.example.json to config.json.`);
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (!cfg.nvr?.host) throw new Error("config.json: nvr.host is required");
  cfg.port ||= 8080;
  cfg.nvr.port ||= 554;
  cfg.nvr.name ||= "NVR";
  cfg.nvr.timeoutMs ||= 15000;
  cfg.nvr.pathTemplate ||= "/Streaming/Channels/{channelCode}";
  cfg.channels = Array.isArray(cfg.channels) && cfg.channels.length ? cfg.channels : defaultChannels(24);
  cfg.channels = cfg.channels.map((channel, index) => ({
    id: Number(channel.id || index + 1),
    rtspChannel: Number(channel.rtspChannel || channel.id || index + 1),
    name: channel.name || `Channel ${channel.id || index + 1}`,
    enabled: channel.enabled !== false,
    stream: channel.stream === "sub" ? "sub" : "main",
  }));
  // Backward compatibility with the project's existing "analysis" config.
  // IMPORTANT: migrate BEFORE applying vision defaults, otherwise
  // "grounding_dino" wins even when analysis.provider is "modified_dino".
  cfg.vision ||= {};
  const legacyAnalysis = cfg.analysis || {};

  if (!cfg.vision.engine && legacyAnalysis.provider) {
    cfg.vision.engine = legacyAnalysis.provider;
  }

  if (cfg.vision.threshold == null && legacyAnalysis.openVocabularyThreshold != null) {
    cfg.vision.threshold = legacyAnalysis.openVocabularyThreshold;
  }

  cfg.vision.engines ||= {};

  if (!cfg.vision.engines.modified_dino && legacyAnalysis.modifiedDino) {
    cfg.vision.engines.modified_dino = { ...legacyAnalysis.modifiedDino };
  }

  cfg.vision.engine ||= "grounding_dino";
  cfg.vision.threshold = numericThreshold(cfg.vision.threshold, 0.35);
  cfg.vision.debug = cfg.vision.debug === true || legacyAnalysis.debug === true;

  cfg.vision.engines.grounding_dino ||= {};
  cfg.vision.engines.grounding_dino.threshold = numericThreshold(
    cfg.vision.engines.grounding_dino.threshold,
    cfg.vision.threshold,
  );

  cfg.vision.engines.modified_dino ||= {};
  cfg.vision.engines.modified_dino.threshold = numericThreshold(
    cfg.vision.engines.modified_dino.threshold,
    cfg.vision.threshold,
  );
  cfg.sampling ||= {};
  cfg.sampling.enabled = false;
  return cfg;
}

function numericThreshold(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export { defaultChannels };

