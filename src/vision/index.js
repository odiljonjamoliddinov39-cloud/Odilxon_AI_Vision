import {
  createVisionEngine,
  listVisionEngines,
  normalizeVisionResult,
  registerVisionEngine
} from "./engine.js";

// Every engine module is imported lazily, inside its own factory, rather than
// eagerly at the top of this file. yolo26.js loads the top-level
// onnxruntime-node native addon at import time; grounding-dino.js and
// modified-dino.js load a different, bundled onnxruntime-node version
// through @huggingface/transformers. Loading both native addons into the
// same process throws a shared-library version conflict
// ("libonnxruntime.so.1: version 'VERS_1.21.0' not found"), so only the
// module for the engine actually selected in config.json may be imported.

registerVisionEngine(
  "none",
  async () => {
    const { NoVisionEngine } = await import("./engines/none.js");
    return new NoVisionEngine();
  }
);

registerVisionEngine(
  "yolo26",
  async (config) => {
    const { Yolo26Engine } = await import("./engines/yolo26.js");
    return new Yolo26Engine(config);
  }
);

registerVisionEngine(
  "yoloe26",
  async (config) => {
    const { YoloE26Engine } = await import("./engines/yoloe26.js");
    return new YoloE26Engine(config);
  }
);

registerVisionEngine(
  "grounding_dino",
  async (config) => {
    const { GroundingDinoEngine } = await import("./engines/grounding-dino.js");
    return new GroundingDinoEngine(config);
  }
);

registerVisionEngine(
  "modified_dino",
  async (config) => {
    const { ModifiedDinoEngine } = await import("./engines/modified-dino.js");
    return new ModifiedDinoEngine(config);
  }
);


export {
  createVisionEngine,
  listVisionEngines,
  normalizeVisionResult
};
