import sys
import json
import base64
import cv2
import numpy as np

from ultralytics import YOLOE


model = YOLOE("yoloe-26n-seg.pt")

model.set_classes([
    "cardboard package",
    "long cardboard package",
    "ceiling cornice package"
])


def analyze(jpeg_bytes, threshold=0.10):
    data = np.frombuffer(jpeg_bytes, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)

    if image is None:
        raise RuntimeError("Could not decode JPEG")

    result = model.predict(
        source=image,
        conf=threshold,
        imgsz=640,
        verbose=False
    )[0]

    objects = []

    if result.boxes is not None:
        for box in result.boxes:
            xyxy = box.xyxy[0].cpu().tolist()

            confidence = float(box.conf[0].cpu())
            class_id = int(box.cls[0].cpu())

            objects.append({
                "classId": class_id,
                "className": result.names.get(class_id, "baget_box"),
                "confidence": confidence,
                "box": {
                    "x1": float(xyxy[0]),
                    "y1": float(xyxy[1]),
                    "x2": float(xyxy[2]),
                    "y2": float(xyxy[3])
                }
            })

    return {
        "engine": "yoloe26",
        "objects": objects,
        "count": len(objects),
        "confidence": max(
            [x["confidence"] for x in objects],
            default=None
        )
    }


for line in sys.stdin:
    line = line.strip()

    if not line:
        continue

    request_id = None

    try:
        request = json.loads(line)
        request_id = request.get("id")

        jpeg = base64.b64decode(
            request["image"]
        )

        threshold = float(
            request.get("threshold", 0.10)
        )

        result = analyze(
            jpeg,
            threshold
        )
        result["id"] = request_id

        print(
            json.dumps(result),
            flush=True
        )

    except Exception as exc:
        print(
            json.dumps({
                "id": request_id,
                "error": str(exc)
            }),
            flush=True
        )
