import {
  createVisionEngine,
  listVisionEngines,
  normalizeVisionResult,
  registerVisionEngine
} from "./engine.js";

import {
  NoVisionEngine
} from "./engines/none.js";

import {
  Yolo26Engine
} from "./engines/yolo26.js";

import {
  YoloE26Engine
} from "./engines/yoloe26.js";

import {
  GroundingDinoEngine
} from "./engines/grounding-dino.js";

import {
  ModifiedDinoEngine
} from "./engines/modified-dino.js";


registerVisionEngine(
  "none",
  () => new NoVisionEngine()
);

registerVisionEngine(
  "yolo26",
  (config) =>
    new Yolo26Engine(config)
);

registerVisionEngine(
  "yoloe26",
  (config) =>
    new YoloE26Engine(config)
);

registerVisionEngine(
  "grounding_dino",
  (config) =>
    new GroundingDinoEngine(config)
);

registerVisionEngine(
  "modified_dino",
  (config) =>
    new ModifiedDinoEngine(config)
);


export {
  createVisionEngine,
  listVisionEngines,
  normalizeVisionResult
};
