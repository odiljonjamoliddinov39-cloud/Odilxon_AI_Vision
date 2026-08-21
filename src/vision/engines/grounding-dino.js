import fs from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { clamp } from "../geometry.js";

const DEFAULT_MODEL_DIR = fileURLToPath(new URL("../../../models/grounding-dino-tiny-ONNX", import.meta.url));

let pipelinePromise;

function assertModelInstalled(modelDirectory) {
  const modelFile = path.join(modelDirectory, "onnx", "model_quantized.onnx");
  if (!fs.existsSync(modelFile)) {
    throw new Error(
      `Grounding DINO model weights are not installed. Expected ${modelFile}. ` +
      `Run "npm run model:install-open-vocabulary" to download them (~203 MB, requires internet access).`,
    );
  }
}

async function loadPipeline(modelDirectory) {
  pipelinePromise ||= (async () => {
    assertModelInstalled(modelDirectory);
    const { env, pipeline, RawImage } = await import("@huggingface/transformers");
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = `${path.dirname(modelDirectory)}${path.sep}`;
    const detector = await pipeline(
      "zero-shot-object-detection",
      path.basename(modelDirectory),
      { dtype: "q8", device: "cpu" },
    );
    return { detector, RawImage };
  })().catch((error) => {
    // Don't memoize a failure: if the model wasn't installed yet, a later
    // call (after the user runs the install script) should retry instead
    // of replaying the same rejected promise for the life of the process.
    pipelinePromise = undefined;
    throw error;
  });
  return pipelinePromise;
}

export class GroundingDinoEngine {
  constructor(config = {}) {
    this.name = "grounding_dino";
    this.modelDirectory = config.modelDirectory || DEFAULT_MODEL_DIR;
    this.threshold = Number.isFinite(Number(config.threshold)) ? Number(config.threshold) : 0.35;
  }

  info() {
    return {
      name: this.name,
      family: "Grounding DINO",
      mode: "stock_onnx_adapter",
      modelDirectory: this.modelDirectory,
      threshold: this.threshold,
      note: "Thin stock adapter. Future modified DINO can replace this engine without touching NVR/capture/dashboard.",
    };
  }

  async analyze({ frame, instruction = {}, debug = false } = {}) {
    const imageSource = typeof frame === "string" ? frame : frame?.filePath || frame?.buffer;
    if (!imageSource) throw Object.assign(new Error("Vision engine requires frame.filePath or frame.buffer."), { status: 400 });

    const target = String(instruction.target || "").trim();
    if (!target) throw Object.assign(new Error("Grounding DINO requires instruction.target."), { status: 400 });

    const threshold = Number.isFinite(Number(instruction.threshold))
      ? clamp(Number(instruction.threshold), 0, 1)
      : this.threshold;

    const metadata = await sharp(imageSource).metadata();
    if (!metadata.width || !metadata.height) throw new Error("Unable to read frame dimensions.");

    const pixels = await sharp(imageSource).toColourspace("srgb").removeAlpha().raw().toBuffer();
    const { detector, RawImage } = await loadPipeline(this.modelDirectory);
    const image = new RawImage(new Uint8Array(pixels), metadata.width, metadata.height, 3);
    const prompt = `${target.toLowerCase().replace(/[.\s]+$/u, "")}.`;

    const started = performance.now();
    const output = await detector(image, [prompt], { threshold });
    const inferenceMs = Math.round(performance.now() - started);

    const objects = output.map((item, index) => {
      const box = item.box || {};
      const xmin = clamp(Number(box.xmin), 0, metadata.width);
      const ymin = clamp(Number(box.ymin), 0, metadata.height);
      const xmax = clamp(Number(box.xmax), 0, metadata.width);
      const ymax = clamp(Number(box.ymax), 0, metadata.height);
      return {
        id: `q${index}`,
        label: target,
        confidence: Number(item.score),
        bbox: {
          x: Math.round(xmin),
          y: Math.round(ymin),
          width: Math.round(xmax - xmin),
          height: Math.round(ymax - ymin),
        },
      };
    }).filter((item) => item.bbox.width > 0 && item.bbox.height > 0);

    return {
      engine: this.name,
      objects,
      count: objects.length,
      confidence: objects.length
        ? objects.reduce((sum, item) => sum + item.confidence, 0) / objects.length
        : null,
      evidence: [{ type: "prompt", value: prompt }],
      inferenceMs,
      debug: debug ? { rawOutputCount: output.length, prompt, threshold } : undefined,
    };
  }
}
