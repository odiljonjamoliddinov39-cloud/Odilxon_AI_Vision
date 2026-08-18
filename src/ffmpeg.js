import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
function exists(p) {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function findRecursive(dir, filename, depth = 0) {
  if (!dir || depth > 5 || !fs.existsSync(dir)) return null;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === filename.toLowerCase())
        return f;
      if (e.isDirectory()) {
        const x = findRecursive(f, filename, depth + 1);
        if (x) return x;
      }
    }
  } catch {}
  return null;
}
export function resolveFfmpeg() {
  if (exists(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  if (process.platform === "win32") {
    const w = spawnSync("where.exe", ["ffmpeg"], { encoding: "utf8" });
    if (w.status === 0) {
      const p = w.stdout
        .split(/\r?\n/)
        .map((x) => x.trim())
        .find(Boolean);
      if (exists(p)) return p;
    }
    const local = process.env.LOCALAPPDATA;
    const root = local
      ? path.join(local, "Microsoft", "WinGet", "Packages")
      : null;
    const found = findRecursive(root, "ffmpeg.exe");
    if (found) return found;
  } else {
    const w = spawnSync("which", ["ffmpeg"], { encoding: "utf8" });
    if (w.status === 0) {
      const p = w.stdout.trim();
      if (exists(p)) return p;
    }
  }
  throw new Error("FFmpeg not found. Install FFmpeg or set FFMPEG_PATH.");
}
