import cv2
from pathlib import Path

from ultralytics import YOLOE, solutions


BASE_DIR = Path(__file__).resolve().parent
VIDEO_PATH = BASE_DIR / "baget.mp4"
OUTPUT_PATH = BASE_DIR / "baget_region_count.mp4"


# --------------------------------------------------
# LOAD VIDEO
# --------------------------------------------------

cap = cv2.VideoCapture(str(VIDEO_PATH))

if not cap.isOpened():
    raise RuntimeError(f"Cannot open video: {VIDEO_PATH}")

w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
fps = cap.get(cv2.CAP_PROP_FPS)

if fps <= 0:
    fps = 30.0

print(f"Video: {w}x{h} @ {fps:.2f} FPS")


# --------------------------------------------------
# YOLOE-26 OPEN-VOCABULARY MODEL
# --------------------------------------------------

model = YOLOE("yoloe-26n-seg.pt")

# THIS is the important part.
model.set_classes([
    "cardboard package",
])


# --------------------------------------------------
# BAGET REGION
#
# Start with almost the entire image.
# Later we shrink this polygon to the pallet/stack area.
# --------------------------------------------------

region_points = {
    "Baget Zone": [
        (10, 10),
        (w - 10, 10),
        (w - 10, h - 10),
        (10, h - 10),
    ]
}


# --------------------------------------------------
# REGION COUNTER
# --------------------------------------------------

counter = solutions.RegionCounter(
    show=True,
    region=region_points,

    # Pass the configured YOLOE model object.
    model=model,

    conf=0.10,
    iou=0.70,
    tracker="bytetrack.yaml",
)


# --------------------------------------------------
# OUTPUT VIDEO
# --------------------------------------------------

writer = cv2.VideoWriter(
    str(OUTPUT_PATH),
    cv2.VideoWriter_fourcc(*"mp4v"),
    fps,
    (w, h),
)

if not writer.isOpened():
    raise RuntimeError("Could not create output video")


# --------------------------------------------------
# PROCESS
# --------------------------------------------------

frame_number = 0

while cap.isOpened():

    ok, frame = cap.read()

    if not ok:
        break

    frame_number += 1

    results = counter(frame)

    print(
        f"Frame {frame_number}: "
        f"{results.region_counts}"
    )

    writer.write(results.plot_im)


cap.release()
writer.release()
cv2.destroyAllWindows()

print("DONE")
print(f"Output: {OUTPUT_PATH}")