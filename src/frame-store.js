import fs from "node:fs";
import path from "node:path";

const FRAME_DIR = path.resolve("sampled-frames");
const INDEX_FILE = path.resolve("data", "frames.jsonl");
const SELECTION_FILE = path.resolve("data", "selected-frame.json");

function readIndex() {
  if (!fs.existsSync(INDEX_FILE)) return [];
  return fs
    .readFileSync(INDEX_FILE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((frame) => fs.existsSync(path.join(FRAME_DIR, frame.filename)));
}

function writeIndex(frames) {
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  const text = frames.map((frame) => JSON.stringify(frame)).join("\n");
  fs.writeFileSync(INDEX_FILE, text ? `${text}\n` : "");
}

export function saveSampledFrame({ camera, capturedAt, jpeg, trigger = "scheduled", maxFrames = 500 }) {
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  const id = `frm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const filename = `${id}.jpg`;
  fs.writeFileSync(path.join(FRAME_DIR, filename), jpeg);
  const frame = {
    id,
    camera,
    capturedAt,
    savedAt: new Date().toISOString(),
    trigger,
    filename,
    url: `/sampled-frames/${filename}`,
    bytes: jpeg.length,
  };
  const frames = [...readIndex(), frame];
  const keep = frames.slice(-Math.max(1, maxFrames));
  const removed = frames.slice(0, Math.max(0, frames.length - keep.length));
  for (const old of removed) {
    try {
      fs.unlinkSync(path.join(FRAME_DIR, old.filename));
    } catch {}
  }
  writeIndex(keep);
  return frame;
}

export function listSampledFrames({ limit = 100, camera } = {}) {
  const selected = getSelectedFrame();
  return readIndex()
    .filter((frame) => !camera || frame.camera === camera)
    .slice(-Math.max(1, Math.min(500, limit)))
    .reverse()
    .map((frame) => ({ ...frame, selected: selected?.id === frame.id }));
}

export function selectFrame(id) {
  const frame = readIndex().find((candidate) => candidate.id === id);
  if (!frame) return null;
  fs.mkdirSync(path.dirname(SELECTION_FILE), { recursive: true });
  const selection = { ...frame, selectedAt: new Date().toISOString() };
  fs.writeFileSync(SELECTION_FILE, `${JSON.stringify(selection, null, 2)}\n`);
  return selection;
}

export function getSelectedFrame() {
  if (!fs.existsSync(SELECTION_FILE)) return null;
  try {
    const selection = JSON.parse(fs.readFileSync(SELECTION_FILE, "utf8"));
    return fs.existsSync(path.join(FRAME_DIR, selection.filename)) ? selection : null;
  } catch {
    return null;
  }
}
