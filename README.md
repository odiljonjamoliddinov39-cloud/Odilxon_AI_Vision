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

## Local object analysis

Analysis uses the local `SSD-MobileNetV1-12` ONNX Model Zoo detector through `onnxruntime-node` on CPU. The model file is `models/ssd_mobilenet_v1_12.onnx` (29,461,455 bytes, SHA-256 `b8fba5e404077d4048d27fcd1667e85e27e192eb9bf51e696c46a3acd7d21058`). Once dependencies and this file are installed, inference requires no internet connection or API key.

`analyze(frame, caseConfig)` is implemented in `src/analyzer.js`. Select `local_closed_class` to use SSD-MobileNetV1-12. Sharp decodes the captured image, converts it to sRGB, removes alpha, and resizes to 300×300 RGB. A uint8 NHWC tensor `[1,300,300,3]` is passed to ONNX Runtime. The model returns normalized `[ymin,xmin,ymax,xmax]` boxes, COCO category IDs, confidence scores, and detection count. Results below the configured confidence threshold are removed; retained boxes are clamped and scaled back to the original captured image width and height. Counts are derived directly from those retained detections.

Supported classes are the model's 80 MS COCO categories and are exported explicitly as `SUPPORTED_CLASSES` in `src/analyzer.js`. Industrial concepts outside that vocabulary—including box, pallet, machine, sack, and PPE state—are not renamed or invented.

Automatic sampling is disabled and the legacy sampling modules are not wired into the server.

## Open-vocabulary analysis

Select `open_vocabulary` and enter one runtime object target. This provider uses Apache-2.0 licensed `onnx-community/grounding-dino-tiny-ONNX` through `@huggingface/transformers`. Install its local assets once with `pnpm.cmd run model:install-open-vocabulary`. The quantized ONNX file is `models/grounding-dino-tiny-ONNX/onnx/model_quantized.onnx` (203,824,675 bytes, SHA-256 `70bf2d3310d1ae73769c96a71e00cbf2861eb33a1f4d97d84a108a7bf02c03c9`). Tokenizer and processor configuration are stored beside it.

At runtime, remote model loading is disabled. The submitted target is normalized to Grounding DINO's required lowercase, period-terminated query. Transformers.js performs the model's 800×800 image preprocessing and grounded detection postprocessing. Its returned boxes are original-image pixel coordinates; the application clamps them to the captured image and performs greedy, same-label IoU NMS before deriving counts. Default thresholds are configurable under `analysis` in `config.json`.

Measured on this Windows machine against stored NVR frame `frm_1786784067016_9epfl.jpg`: target `pallet` produced two retained detections in 5,092 ms at threshold 0.25, then target `white sack` produced six in 6,444 ms in the same Node process. Results depend on the frame, target wording, threshold, and hardware; a zero-result response remains valid and is never replaced with guessed detections.

### Optional individual-instance counting evaluation

The workspace can run the entered target through four prompts: `{target}`, `individual {target}`, `single {target}`, and `each {target}`. Candidate boxes from all four real inferences are confidence-sorted and merged with configurable same-target IoU NMS; they are never summed blindly and no boxes are synthesized. The response includes `target`, retained `detections`, `count`, `promptUsed`, and total model `inferenceMs`, while retaining `counts` and `totalCount` for the existing workspace renderer.

Evaluation at confidence 0.20 and NMS IoU 0.50 on real NVR imagery found that this Grounding DINO Tiny model is not a reliable carton instance counter in dense stacks. A current immutable frame containing dozens of visible cardboard cartons produced 6 retained detections in 60,861 ms; its strongest box covered a palletized group rather than one carton. On a separate NVR frame containing isolated and grouped white sacks, it produced 12 retained boxes in 25,493 ms, but mixed individual-sack boxes with larger group boxes, so the returned count double-represented some objects. The mode exposes the model's genuine boxes for evaluation, but its count must not be interpreted as ground truth when targets overlap or form stacks.
