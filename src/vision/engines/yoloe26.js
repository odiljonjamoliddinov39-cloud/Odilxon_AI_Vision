import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

export class YoloE26Engine {
  constructor(config = {}) {
    this.name = "yoloe26";
    this.threshold = Number(config.threshold ?? 0.10);
    this.timeoutMs = Number(config.timeoutMs ?? 60000);

    this.python =
      config.python ||
      process.env.YOLOE26_PYTHON ||
      (process.platform === "win32" ? "python.exe" : "python3");

    this.script =
      config.script ||
      path.resolve("src", "yoloe_service.py");

    this.process = null;
    // Keyed by request id, not FIFO order: Python is a single-threaded
    // sequential consumer, so a request that outlives this engine's own
    // timeout (e.g. a slow cold-start inference) does not stop Python from
    // eventually finishing and writing a response. Matching by id means a
    // late response either finds nothing (harmlessly dropped) instead of
    // being misattributed to a different, still-pending request that
    // happened to be first in a shift()-based queue.
    this.pending = new Map();
    this.starting = null;
  }

  async init() {
    if (this.process) return;

    if (this.starting) {
      await this.starting;
      return;
    }

    this.starting = new Promise((resolve, reject) => {
      console.log("[YOLOE26] starting Python...");

      const script = path.resolve(this.script);

      this.process = spawn(
        this.python,
        ["-u", script],
        {
          cwd: process.cwd(),
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true
        }
      );

      const rl = readline.createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity
      });

      rl.on("line", (line) => {
        const text = line.trim();

        if (!text) return;

        if (!text.startsWith("{")) {
          console.log("[YOLOE26 PY]", text);
          return;
        }

        let result;

        try {
          result = JSON.parse(text);
        } catch {
          console.log("[YOLOE26 PY RAW]", text);
          return;
        }

        const job = this.pending.get(result.id);

        if (!job) {
          console.log(
            `[YOLOE26] response for unknown or already-timed-out request ${result.id ?? "(no id)"}`
          );
          return;
        }

        this.pending.delete(result.id);
        clearTimeout(job.timer);

        if (result.error) {
          job.reject(
            new Error(result.error)
          );
        } else {
          job.resolve(result);
        }
      });

      this.process.stderr.on(
        "data",
        (data) => {
          const text =
            data.toString().trim();

          if (text) {
            console.log(
              "[YOLOE26 STDERR]",
              text
            );
          }
        }
      );

      this.process.once(
        "spawn",
        () => {
          console.log(
            "[YOLOE26] Python process started"
          );

          resolve();
        }
      );

      this.process.once(
        "error",
        (error) => {
          this.process = null;
          reject(error);
        }
      );

      this.process.on(
        "exit",
        (code) => {
          console.log(
            "[YOLOE26] Python exited:",
            code
          );

          this.process = null;
          this.starting = null;

          for (const job of this.pending.values()) {
            clearTimeout(job.timer);

            job.reject(
              new Error(
                `YOLOE26 Python exited (${code})`
              )
            );
          }

          this.pending.clear();
        }
      );
    });

    await this.starting;
  }

  info() {
    return {
      name: this.name,
      enabled: true,
      threshold: this.threshold,
      model: "yoloe-26n-seg.pt"
    };
  }

  async analyze(input) {
    await this.init();

    const started = Date.now();

    const jpeg =
      Buffer.isBuffer(input)
        ? input
        : input?.frame?.buffer ||
          input?.buffer ||
          input?.jpeg ||
          input?.image ||
          (input?.frame?.filePath ? fs.readFileSync(input.frame.filePath) : null);

    if (!Buffer.isBuffer(jpeg)) {
      throw new Error(
        "YOLOE26 requires a JPEG Buffer or frame.filePath"
      );
    }

    console.log(
      `[YOLOE26] analyzing ${jpeg.length} bytes`
    );

    const id = crypto.randomUUID();

    const result =
      await new Promise(
        (resolve, reject) => {

          const timer = setTimeout(
            () => {
              this.pending.delete(id);

              reject(
                new Error(
                  `YOLOE26 inference timed out after ${this.timeoutMs}ms`
                )
              );
            },
            this.timeoutMs
          );

          this.pending.set(id, {
            resolve,
            reject,
            timer
          });

          const payload =
            JSON.stringify({
              id,

              image:
                jpeg.toString("base64"),

              threshold:
                this.threshold
            }) + "\n";

          this.process.stdin.write(
            payload,
            "utf8",
            error => {
              if (error) {
                this.pending.delete(id);
                clearTimeout(timer);

                reject(error);
              }
            }
          );
        }
      );

    console.log(
      `[YOLOE26] result: ${result.count} detections`
    );

    return {
      engine: "yoloe26",
      objects: result.objects || [],
      count: Number(result.count ?? 0),
      confidence:
        result.confidence ?? null,
      evidence: [],
      inferenceMs:
        Date.now() - started
    };
  }
}
