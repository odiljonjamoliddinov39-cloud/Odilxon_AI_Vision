# Vision JS + Grounding DINO engine merge

This merge keeps the working acquisition side and replaces the fixed analyzer architecture with a generic vision-engine boundary.

## Protected working flow

- NVR configuration
- 24-channel grid
- RTSP/FFmpeg frame acquisition
- live MJPEG session
- immutable frame capture
- capture store
- dashboard workspace

## New architecture

```text
NVR -> live/capture -> persisted frame
                     |
                     v
              VisionEngine contract
                     |
          +----------+-----------+
          |                      |
   grounding_dino          modified_dino
   stock ONNX adapter      future derivative
```

## Important: use your existing config.json

This ZIP intentionally does **not** contain `config.json`, because the source archive you uploaded contained live NVR credentials.

Copy your existing `config.json` into this merged project and add:

```json
"vision": {
  "engine": "grounding_dino",
  "threshold": 0.35,
  "debug": false,
  "engines": {
    "grounding_dino": { "threshold": 0.35 },
    "modified_dino": { "modelPath": "" }
  }
}
```

Old `analysis` settings are ignored by the merged runtime.

## Model directory

The source-only upload did not contain `models/`.

Copy your existing:

`models/grounding-dino-tiny-ONNX/`

into this merged project's `models/` directory before starting.

## Start

```cmd
npm.cmd install
npm.cmd start
```

## Next DINO research step

Do **not** build a counting engine yet.

First inspect stock Grounding DINO's internal 900 proposals/decoder queries on one real Baget frame. The upstream source is included under `research/groundingdino-upstream`.

The original `.pth` checkpoint is still needed to run that internal inspection.
