const ENGINES = new Map();

export function registerVisionEngine(name, factory) {
  if (!name || typeof factory !== "function") throw new Error("Vision engine registration requires a name and factory.");
  ENGINES.set(name, factory);
}

export function listVisionEngines() {
  return [...ENGINES.keys()];
}

export async function createVisionEngine(name, config = {}) {
  const factory = ENGINES.get(name);
  if (!factory) throw Object.assign(new Error(`Unknown vision engine: ${name}`), { status: 400 });
  const engine = await factory(config);
  if (!engine || typeof engine.analyze !== "function") throw new Error(`Vision engine "${name}" is invalid.`);
  return engine;
}

export function normalizeVisionResult(result = {}) {
  const objects = Array.isArray(result.objects) ? result.objects : [];
  return {
    engine: result.engine || "unknown",
    objects,
    count: Number.isInteger(result.count) ? result.count : objects.length,
    confidence: result.confidence ?? null,
    evidence: Array.isArray(result.evidence) ? result.evidence : [],
    inferenceMs: Number(result.inferenceMs || 0),
    debug: result.debug || undefined,
  };
}
