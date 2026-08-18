# Modified DINO — recursive stack decomposition

This build implements the requested behavior directly:

1. Grounding DINO locates the requested object/stack regions.
2. The same Grounding DINO is re-run inside each detected region at higher effective visual scale.
3. If the region produces multiple non-duplicate child detections, the parent is replaced by the children.
4. The process repeats up to `maxDepth`.
5. Final leaf instances are counted.

No YOLO. No VLM. No synthetic boxes. No training dataset.

## Enable it

In your existing `config.json`, add/replace:

```json
"vision": {
  "engine": "modified_dino",
  "threshold": 0.25,
  "debug": true,
  "engines": {
    "modified_dino": {
      "threshold": 0.25,
      "childThreshold": 0.12,
      "maxDepth": 2,
      "nmsIou": 0.42,
      "margin": 0.04,
      "minCropPixels": 80
    }
  }
}
```

Keep your existing NVR credentials and model folder.

## What this version changes

Stock:
`DINO -> stack region -> count stack as 1`

Modified:
`DINO -> stack region -> crop/zoom -> DINO again -> child regions -> repeat -> final physical candidates -> count`

A parent is only replaced when at least two non-duplicate child detections exist. It never invents missing boxes.

## Run

```cmd
npm.cmd start
```

Capture the same frame, target `baget box`, and click Analyze.

With `debug=true`, `/api/analyze` returns a decomposition trace showing which DINO regions were kept or split.
