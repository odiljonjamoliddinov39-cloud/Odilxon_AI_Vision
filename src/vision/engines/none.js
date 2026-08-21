export class NoVisionEngine {
  constructor() {
    this.name = "none";
  }

  info() {
    return {
      name: this.name,
      enabled: false
    };
  }

  async analyze() {
    return {
      engine: this.name,
      objects: [],
      count: 0,
      confidence: null,
      evidence: [],
      inferenceMs: 0
    };
  }
}
