import fs from "node:fs";
import path from "node:path";

const CAPTURE_DIR = path.resolve("analysis-frames");
const INDEX_FILE = path.resolve("data", "analysis-frames.jsonl");

function readAll() {
  if (!fs.existsSync(INDEX_FILE)) return [];
  return fs.readFileSync(INDEX_FILE, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

export function saveAnalysisFrame({ channel, jpeg, capturedAt }) {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  const id = `frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const filename = `${id}.jpg`;
  fs.writeFileSync(path.join(CAPTURE_DIR, filename), jpeg);
  const frame = {
    id,
    channelId: channel.id,
    rtspChannel: channel.rtspChannel || channel.id,
    channelName: channel.name,
    capturedAt,
    filename,
    url: `/analysis-frames/${filename}`,
    bytes: jpeg.length,
  };
  fs.appendFileSync(INDEX_FILE, `${JSON.stringify(frame)}\n`);
  return frame;
}

export function getAnalysisFrame(id) {
  const frame = readAll().find((item) => item.id === id);
  if (!frame) return null;
  const filePath = path.join(CAPTURE_DIR, frame.filename);
  return fs.existsSync(filePath) ? { ...frame, filePath } : null;
}

export function listAnalysisFrames(limit = 30, channelId) {
  return readAll()
    .filter((frame) => !channelId || frame.channelId === Number(channelId))
    .slice(-Math.max(1, Math.min(100, limit)))
    .reverse();
}
