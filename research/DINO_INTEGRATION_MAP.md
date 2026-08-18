# Grounding DINO integration map

## Runtime boundary

The production application stays JavaScript/Node.

`src/vision/engine.js` is now the only application-facing vision contract.

Current stock adapter:
`src/vision/engines/grounding-dino.js`

Future modified adapter:
`src/vision/engines/modified-dino.js`

The NVR, live MJPEG, capture-store and workspace do not depend on DINO internals.

## Upstream source included for research

The original Grounding DINO repository is vendored under:

`research/groundingdino-upstream/`

It is research/reference source only and is not executed by Node.

## First internal points to inspect

Swin-T config:
`groundingdino/config/GroundingDINO_SwinT_OGC.py`

Important setting:
`num_queries = 900`

Core model:
`groundingdino/models/GroundingDINO/groundingdino.py`

Transformer:
`groundingdino/models/GroundingDINO/transformer.py`

The two-stage transformer ranks encoder proposals, selects `self.num_queries` top proposals, then passes them through the decoder. The decoder returns:

- `hs`: decoder query representations
- `references`: per-layer query reference boxes
- `hs_enc`
- `ref_enc`
- `init_box_proposal`

This is the correct seam for the next experiment: inspect the 900 proposal/query states before normal user-facing thresholding/postprocessing and determine whether individual physical instances are already represented.

## Deliberately removed

The main runtime no longer contains:

- SSD-MobileNet closed-class provider
- `local_closed_class`
- `open_vocabulary` provider switching
- prompt-variant counting heuristics
- `countIndividualInstances`
- fixed industrial case builders
- application-level NMS experiments

Those were experiments, not architecture.

## Missing artifact

The original `.pth` Grounding DINO checkpoint was not included with the uploaded source ZIP. The upstream source is integrated, but internal PyTorch query inspection cannot be executed until the checkpoint is supplied.
