import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

export class YoloE26Engine {
  constructor(config = {}) {
    this.name = "yoloe26";
    this.threshold = Number(config.threshold ?? 0.10);

    this.python =
      config.python ||
      "C:\\Python314\\python.exe";

    this.script =
      config.script ||
      path.resolve("src", "yoloe_service.py");

    this.process = null;
    this.pending = [];
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

        const job = this.pending.shift();

        if (!job) {
          console.log(
            "[YOLOE26] response with no pending request"
          );
          return;
        }

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

          while (this.pending.length) {
            const job =
              this.pending.shift();

            clearTimeout(job.timer);

            job.reject(
              new Error(
                `YOLOE26 Python exited (${code})`
              )
            );
          }
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
          input?.image;

    if (!Buffer.isBuffer(jpeg)) {
      throw new Error(
        "YOLOE26 requires JPEG Buffer"
      );
    }

    console.log(
      `[YOLOE26] analyzing ${jpeg.length} bytes`
    );

    const result =
      await new Promise(
        (resolve, reject) => {

          const timer = setTimeout(
            () => {
              const index =
                this.pending.findIndex(
                  x => x.timer === timer
                );

              if (index >= 0) {
                this.pending.splice(
                  index,
                  1
                );
              }

              reject(
                new Error(
                  "YOLOE26 inference timed out after 30s"
                )
              );
            },
            30000
          );

          this.pending.push({
            resolve,
            reject,
            timer
          });

          const payload =
            JSON.stringify({
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
