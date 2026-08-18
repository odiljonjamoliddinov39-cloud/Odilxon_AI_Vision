import { registerVisionEngine } from "./engine.js";
import { GroundingDinoEngine } from "./engines/grounding-dino.js";
import { ModifiedDinoEngine } from "./engines/modified-dino.js";

registerVisionEngine(
  "grounding_dino",
  (config) => new GroundingDinoEngine(config)
);

registerVisionEngine(
  "modified_dino",
  (config) => new ModifiedDinoEngine(config)
);

export {
  createVisionEngine,
  listVisionEngines,
  normalizeVisionResult
} from "./engine.js";
