import fs from "node:fs";
import path from "node:path";
const EVENT_FILE = path.resolve("data", "events.jsonl"),
  EVIDENCE_DIR = path.resolve("evidence");
export function saveAnalysis({
  camera,
  caseType,
  params,
  frames,
  analysis,
  latencyMs,
}) {
  fs.mkdirSync(path.dirname(EVENT_FILE), { recursive: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const evidence = frames.map((f, i) => {
    const name = `${id}_frame_${i + 1}.jpg`;
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), f.jpeg);
    return `/evidence/${name}`;
  });
  const event = {
    id,
    timestamp: new Date().toISOString(),
    camera,
    case: caseType,
    params,
    latencyMs,
    evidence,
    analysis,
  };
  fs.appendFileSync(EVENT_FILE, JSON.stringify(event) + "\n");
  return event;
}
export function listEvents(limit = 30) {
  if (!fs.existsSync(EVENT_FILE)) return [];
  const txt = fs.readFileSync(EVENT_FILE, "utf8").trim();
  if (!txt) return [];
  return txt
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .reverse()
    .map((x) => {
      try {
        return JSON.parse(x);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
