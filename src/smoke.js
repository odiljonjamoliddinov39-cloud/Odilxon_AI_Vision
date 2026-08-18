import { loadConfig, buildRtspUrl } from "./config.js";
import { resolveFfmpeg } from "./ffmpeg.js";
import { FrameSource } from "./frame-source.js";

const cfg = loadConfig();
const channelId = Number(process.env.VISION_CHANNEL || 24);
const channel = cfg.channels.find((item) => item.id === channelId && item.enabled);
if (!channel) throw new Error(`Configured channel ${channelId} not found`);
const ffmpegPath = resolveFfmpeg();
const source = new FrameSource({ rtspUrl: buildRtspUrl(cfg.nvr, channel), ffmpegPath, timeoutMs: cfg.nvr.timeoutMs });
try {
  const jpeg = await source.snapshot();
  console.log(`PASS: real Channel ${channelId} frame received (${jpeg.length} bytes)`);
  console.log(`FFmpeg: ${ffmpegPath}`);
} catch (error) {
  console.error(`FAIL Channel ${channelId}:`, error.message);
  process.exit(1);
}
