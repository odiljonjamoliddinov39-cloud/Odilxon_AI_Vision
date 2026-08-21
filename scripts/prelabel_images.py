"""Pre-label a folder of images with candidate baget-box bounding boxes so a
human only has to correct them in CVAT instead of drawing every box from
scratch.

This is a draft-generation aid, not a labeling tool: yoloe26 (the same
open-vocabulary model used by src/yoloe_service.py) undercounts badly on
dense stacks, so treat its output as a rough starting point. Review every
image; expect the dense ones to need substantial correction or a full
manual redraw.

Usage:
    python3 scripts/prelabel_images.py <input_images_dir> <output_dir> [--conf 0.08]

Output layout (import-ready for CVAT's "Upload annotations" -> YOLO 1.1):
    <output_dir>/
        obj.names                  # single line: baget_box
        labels/<image_stem>.txt    # YOLO cx,cy,w,h per box, one file per image
                                    # (written even when empty, so CVAT sees
                                    # confirmed-empty vs not-yet-reviewed)
"""

import argparse
import sys
from pathlib import Path

CLASS_NAME = "baget_box"
PROMPT_CLASSES = [
    "cardboard package",
    "long cardboard package",
    "ceiling cornice package",
]
IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_dir", help="Folder of raw images to pre-label")
    parser.add_argument("output_dir", help="Where to write obj.names + labels/*.txt")
    parser.add_argument("--conf", type=float, default=0.08, help="Detection confidence threshold (lower = more candidate boxes, more false positives to reject)")
    parser.add_argument("--model", default="yoloe-26n-seg.pt", help="Path to the YOLOE checkpoint")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    labels_dir = output_dir / "labels"
    labels_dir.mkdir(parents=True, exist_ok=True)

    images = sorted(p for p in input_dir.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if not images:
        print(f"No images found in {input_dir}", file=sys.stderr)
        sys.exit(1)

    from ultralytics import YOLOE
    import cv2

    model = YOLOE(args.model)
    model.set_classes(PROMPT_CLASSES)

    (output_dir / "obj.names").write_text(CLASS_NAME + "\n")

    total_boxes = 0
    for img_path in images:
        image = cv2.imread(str(img_path))
        if image is None:
            print(f"  SKIP (unreadable): {img_path.name}", file=sys.stderr)
            continue
        height, width = image.shape[:2]

        result = model.predict(source=image, conf=args.conf, imgsz=640, verbose=False)[0]

        lines = []
        if result.boxes is not None:
            for box in result.boxes:
                x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
                cx = (x1 + x2) / 2 / width
                cy = (y1 + y2) / 2 / height
                w = (x2 - x1) / width
                h = (y2 - y1) / height
                lines.append(f"0 {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")

        label_path = labels_dir / f"{img_path.stem}.txt"
        label_path.write_text("\n".join(lines) + ("\n" if lines else ""))
        total_boxes += len(lines)
        print(f"  {img_path.name:45s} candidate boxes: {len(lines)}")

    print(f"\n{len(images)} images processed, {total_boxes} candidate boxes written to {labels_dir}")
    print("Review every image in CVAT before trusting these - dense stacks especially.")


if __name__ == "__main__":
    main()
