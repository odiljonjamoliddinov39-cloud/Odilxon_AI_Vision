import * as ort from "onnxruntime-node";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

export class Yolo26Engine {
  constructor(config = {}) {
    this.name = "yolo26";
    this.modelPath =
      config.modelPath ||
      path.resolve("models", "yolo26", "yolo26n.onnx");

    this.threshold = Number(config.threshold ?? 0.35);

    this.session = null;
    this.inputName = null;
    this.outputName = null;
  }

  async init() {
    if (this.session) return;

    this.session = await ort.InferenceSession.create(this.modelPath, {
      executionProviders: ["cpu"],
    });

    this.inputName = this.session.inputNames[0];
    this.outputName = this.session.outputNames[0];

    console.log("[YOLO26] model loaded:", this.modelPath);
    console.log("[YOLO26] input:", this.inputName);
    console.log("[YOLO26] output:", this.outputName);
  }

  info() {
    return {
      name: this.name,
      enabled: true,
      modelPath: this.modelPath,
      threshold: this.threshold,
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

    if (!jpeg) {
      throw new Error("YOLO26 analyze() requires a JPEG Buffer or frame.filePath");
    }

    const { data } = await sharp(jpeg)
      .resize(640, 640, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const tensorData = new Float32Array(3 * 640 * 640);
    const pixels = 640 * 640;

    for (let i = 0; i < pixels; i++) {
      tensorData[i] = data[i * 3] / 255.0;
      tensorData[pixels + i] = data[i * 3 + 1] / 255.0;
      tensorData[pixels * 2 + i] = data[i * 3 + 2] / 255.0;
    }

    const tensor = new ort.Tensor(
      "float32",
      tensorData,
      [1, 3, 640, 640]
    );

    const outputs = await this.session.run({
      [this.inputName]: tensor,
    });

    const output = outputs[this.outputName];
    const values = output.data;
    const detections = [];

    for (let i = 0; i < 300; i++) {
      const offset = i * 6;

      const confidence = Number(values[offset + 4]);

      if (!Number.isFinite(confidence)) continue;
      if (confidence < this.threshold) continue;

      detections.push({
        classId: Number(values[offset + 5]),
        confidence,
        box: {
          x1: Number(values[offset]),
          y1: Number(values[offset + 1]),
          x2: Number(values[offset + 2]),
          y2: Number(values[offset + 3]),
        },
      });
    }

    return {
      engine: this.name,
      objects: detections,
      count: detections.length,
      confidence:
        detections.length
          ? Math.max(...detections.map((x) => x.confidence))
          : null,
      evidence: [],
      inferenceMs: Date.now() - started,
    };
  }
}
