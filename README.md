# Vision JS NVR

JavaScript NVR workspace with controlled per-channel previews and immutable manual analysis captures.

## Start

1. Copy `config.example.json` to `config.json` and configure the NVR connection once.
2. Configure channel names and main/sub streams in `channels`.
3. Install dependencies with `npm.cmd install`.
4. Run `npm.cmd run smoke` to test Channel 24, or set `VISION_CHANNEL`.
5. Run `npm.cmd start` and open `http://localhost:8080`.

RTSP URLs are generated at runtime from `nvr` plus each channel's ID and stream. The camera grid uses the existing one-shot `FrameSource.snapshot()` path and does not keep 24 permanent FFmpeg processes.

An optional per-entry `rtspChannel` maps a grid position to a different physical NVR channel. The current deployment skips unavailable physical Channel 11: grid positions 11–24 map to NVR Channels 12–25.

Grid previews remain one-shot snapshots. Opening a workspace starts one persistent FFmpeg decoder for that channel and streams its decoded JPEG frames to the browser without writing them to disk. Switching cameras, closing the workspace, disconnecting the preview, or stopping the server terminates that decoder.

Manual Capture Frame copies the latest in-memory frame from the active live session. It creates one JPEG under `analysis-frames/` and one metadata record under `data/analysis-frames.jsonl`; it does not open another RTSP connection. Analysis always references that exact frame ID.

`GET /api/channels/:id/diagnostics` returns credential-free main/sub RTSP URLs, channel codes, live-session state, the latest FFmpeg error, and retained FFmpeg stderr. Channel 11 therefore reports generated codes `1101` and `1102` plus the underlying failure when decoding fails.

## Vision engines

Analysis runs through a pluggable engine registry (`src/vision/index.js`, `src/vision/engine.js`). `config.json` selects one engine under `vision.engine`, with per-engine options under `vision.engines.<name>`. Only the selected engine's module is imported (lazily, inside its factory) — `yolo26`'s `onnxruntime-node` and `grounding_dino`/`modified_dino`'s bundled `onnxruntime-node` (pulled in via `@huggingface/transformers`) are two different native builds that crash with a shared-library version conflict if both load into the same process, so importing every engine eagerly at startup is not safe.

```json
"vision": {
  "engine": "yoloe26",
  "threshold": 0.10,
  "debug": false,
  "engines": {
    "yoloe26": { "threshold": 0.10 },
    "grounding_dino": { "threshold": 0.35 },
    "modified_dino": { "threshold": 0.25, "nmsIou": 0.42 },
    "yolo26": { "threshold": 0.35 }
  }
}
```

Every engine's `analyze({ frame, instruction, debug })` accepts a captured frame as either `frame.filePath` (from `/api/analyze`, an immutable capture) or `frame.buffer` (from the live continuous-analysis loop) — both endpoints work with every engine.

- **`none`** (`src/vision/engines/none.js`) — no-op engine; always returns zero objects. Default when `vision.engine` is unset.

- **`grounding_dino`** (`src/vision/engines/grounding-dino.js`) — stock open-vocabulary detection using Apache-2.0 `onnx-community/grounding-dino-tiny-ONNX` through `@huggingface/transformers`, CPU-only, remote model loading disabled at runtime. Install its local assets once with `npm run model:install-open-vocabulary` (downloads into `models/grounding-dino-tiny-ONNX/`, SHA-256-verified). The runtime target is normalized to Grounding DINO's lowercase, period-terminated query; returned boxes are clamped to the captured image.

- **`yoloe26`** (`src/vision/engines/yoloe26.js`) — open-vocabulary segmentation via Ultralytics YOLOE, run out-of-process through `src/yoloe_service.py`. Node spawns a persistent Python subprocess and exchanges newline-delimited JSON over stdio (JPEG bytes in, detections out). Requires Python 3 with `ultralytics`, `opencv-python`, and `numpy` installed, plus `yoloe-26n-seg.pt` at the repo root (already included). The Python interpreter defaults to `python3` (`python.exe` on Windows) resolved from `PATH`; override with `vision.engines.yoloe26.python` or the `YOLOE26_PYTHON` environment variable. This is the default engine in `config.example.json`.

- **`grounding_dino`** (`src/vision/engines/grounding-dino.js`) — stock open-vocabulary detection using Apache-2.0 `onnx-community/grounding-dino-tiny-ONNX` through `@huggingface/transformers`, CPU-only, remote model loading disabled at runtime. Install its local assets once with `npm run model:install-open-vocabulary` (downloads into `models/grounding-dino-tiny-ONNX/`, SHA-256-verified). The runtime target is normalized to Grounding DINO's lowercase, period-terminated query; returned boxes are clamped to the captured image.

- **`modified_dino`** (`src/vision/engines/modified-dino.js`) — the same Grounding DINO model, but each detected stack region is re-analyzed with an edge/seam decomposition pass (`src/vision/stack/edge-instance-counter.js`) that looks for carton boundaries inside the region and splits a stack into individual physical-item counts instead of counting it as one object. It never invents boxes: a stack is only split when at least two non-duplicate child boxes have real edge evidence. See `MODIFIED_DINO_README.md` for the full algorithm and tuning knobs (`childThreshold`, `maxDepth`, `nmsIou`, `margin`, `minCropPixels`). Requires the same `models/grounding-dino-tiny-ONNX/` assets as `grounding_dino`.

- **`yolo26`** (`src/vision/engines/yolo26.js`) — local closed-vocabulary detection via `onnxruntime-node`, expecting an ONNX export at `models/yolo26/yolo26n.onnx`. This project ships the Ultralytics checkpoint `yolo26n.pt` at the repo root but **not** an ONNX export — convert it yourself (e.g. `yolo export model=yolo26n.pt format=onnx`) and place the result at that path before selecting this engine.

Automatic background sampling is disabled; `src/frame-sampler.js` and `src/store.js` are legacy modules not wired into the server.

`research/groundingdino-upstream/` vendors the upstream Grounding DINO Python source for reference during model research and is not imported by the running app.
