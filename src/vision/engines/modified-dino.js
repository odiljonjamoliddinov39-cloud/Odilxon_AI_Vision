import fs from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { clamp, suppressOverlapping } from "../geometry.js";
import { countIndividualBoxes } from "../stack/edge-instance-counter.js";

const DEFAULT_MODEL_DIR = fileURLToPath(
  new URL("../../../models/grounding-dino-tiny-ONNX", import.meta.url),
);

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

async function detectDino(buffer, width, height, target, threshold, modelDirectory) {
  const { detector, RawImage } = await loadPipeline(modelDirectory);
  const pixels = await sharp(buffer).toColourspace("srgb").removeAlpha().raw().toBuffer();
  const image = new RawImage(new Uint8Array(pixels), width, height, 3);
  const prompt = `${target.toLowerCase().replace(/[.\s]+$/u, "")}.`;
  const output = await detector(image, [prompt], { threshold });

  return output.map((item, index) => {
    const b = item.box || {};
    const x1 = clamp(Number(b.xmin), 0, width);
    const y1 = clamp(Number(b.ymin), 0, height);
    const x2 = clamp(Number(b.xmax), 0, width);
    const y2 = clamp(Number(b.ymax), 0, height);
    return {
      id: `dino_${index}`,
      label: target,
      confidence: Number(item.score),
      bbox: {
        x: Math.round(x1), y: Math.round(y1),
        width: Math.round(x2 - x1), height: Math.round(y2 - y1),
      },
    };
  }).filter(x => x.bbox.width > 8 && x.bbox.height > 8);
}

export class ModifiedDinoEngine {
  constructor(config = {}) {
    this.name = "modified_dino";
    this.modelDirectory = config.modelDirectory || DEFAULT_MODEL_DIR;
    this.threshold = Number.isFinite(Number(config.threshold)) ? Number(config.threshold) : 0.25;
    this.nmsIou = Number.isFinite(Number(config.nmsIou)) ? Number(config.nmsIou) : 0.42;
    // Two overlapping DINO root detections of the same physical stack often
    // differ a lot in size (e.g. one box crops just part of a pile, another
    // spans the whole thing), which keeps plain IoU low even though one is
    // essentially contained in the other. rootContainmentThreshold catches
    // that case so duplicate roots don't each get independently decomposed
    // and summed, wildly overcounting.
    this.rootContainmentThreshold = Number.isFinite(Number(config.rootContainmentThreshold))
      ? Number(config.rootContainmentThreshold)
      : 0.7;
  }

  info() {
    return {
      name: this.name,
      family: "Grounding DINO + carton seam decomposer",
      mode: "stack_roi_to_physical_layers",
      threshold: this.threshold,
    };
  }

  async analyze({ frame, instruction = {}, debug = false } = {}) {
    const imageSource = typeof frame === "string" ? frame : frame?.filePath || frame?.buffer;
    if (!imageSource) throw Object.assign(new Error("Vision engine requires frame.filePath or frame.buffer."), { status: 400 });

    const target = String(instruction.target || "").trim();
    if (!target) throw Object.assign(new Error("instruction.target required."), { status: 400 });

    const threshold = Number.isFinite(Number(instruction.threshold))
      ? clamp(Number(instruction.threshold), 0, 1)
      : this.threshold;

    const fullBuffer = await sharp(imageSource).jpeg({ quality: 95 }).toBuffer();
    const meta = await sharp(fullBuffer).metadata();
    const imageSize = { width: meta.width, height: meta.height };

    const started = performance.now();

    // Stage 1: DINO finds STACK ROIs only.
    const roots = suppressOverlapping(
      await detectDino(
        fullBuffer,
        imageSize.width,
        imageSize.height,
        target,
        threshold,
        this.modelDirectory
      ),
      this.nmsIou,
      this.rootContainmentThreshold
    );

    const objects = [];
    const trace = [];
    let physicalCount = 0;

    // Stage 2: decompose/count INSIDE each stack.
    // IMPORTANT: child cells are evidence only. They are NOT returned as UI objects.
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      const result = await countIndividualBoxes({
        imageBuffer: fullBuffer,
        root,
        imageSize,
        target,
      });

      const children = Array.isArray(result?.instances) ? result.instances : [];

      // If decomposition returned only the original DINO root, we have no trustworthy
      // internal split. Treat the stack conservatively as one visible physical item.
      const looksLikeFallback =
        children.length === 1 &&
        children[0]?.bbox?.x === root.bbox.x &&
        children[0]?.bbox?.y === root.bbox.y &&
        children[0]?.bbox?.width === root.bbox.width &&
        children[0]?.bbox?.height === root.bbox.height;

      const stackCount = Math.max(
        1,
        looksLikeFallback ? 1 : children.length
      );

      physicalCount += stackCount;

      // ONE object for the dashboard: original DINO stack bbox + internal count.
      objects.push({
        id: `stack_${i + 1}`,
        label: `${target} x${stackCount}`,
        baseLabel: target,
        kind: "stack",
        confidence: root.confidence,
        bbox: { ...root.bbox },
        count: stackCount,
        stackCount,
        childCount: stackCount,

        // Keep child geometry available to API/debug consumers, but the normal
        // renderer sees only this single stack object.
        decomposition: {
          count: stackCount,
          instances: children.map((child, childIndex) => ({
            id: `stack_${i + 1}_child_${childIndex + 1}`,
            bbox: child.bbox,
            confidence: child.confidence ?? root.confidence,
          })),
        },
      });

      trace.push({
        stack: i + 1,
        root: root.bbox,
        stackCount,
        ...result.debug,
      });
    }

    const inferenceMs = Math.round(performance.now() - started);

    return {
      engine: this.name,

      // UI draws exactly one bbox per DINO stack.
      objects,

      // This is the useful production count: sum of physical boxes inside stacks.
      count: physicalCount,

      confidence: objects.length
        ? objects.reduce((sum, x) => sum + Number(x.confidence || 0), 0) / objects.length
        : null,

      evidence: [
        { type: "dino_stack_roots", value: roots.length },
        { type: "physical_box_count", value: physicalCount },
        {
          type: "stack_counts",
          value: objects.map(x => ({
            id: x.id,
            count: x.stackCount,
          })),
        },
      ],

      inferenceMs,

      debug: debug
        ? {
            mode: "stack_bbox_with_internal_count",
            decompositionTrace: trace,
          }
        : undefined,
    };
  }
}
