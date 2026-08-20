import cv2
from pathlib import Path
from ultralytics import solutions


# --------------------------------------------------
# PATHS
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
VIDEO_PATH = BASE_DIR / "baget.mp4"
OUTPUT_PATH = BASE_DIR / "object_counting_output.mp4"

print(f"Reading video: {VIDEO_PATH}")

if not VIDEO_PATH.exists():
    raise FileNotFoundError(f"Video not found: {VIDEO_PATH}")


# --------------------------------------------------
# OPEN VIDEO
# --------------------------------------------------

cap = cv2.VideoCapture(str(VIDEO_PATH))

if not cap.isOpened():
    raise RuntimeError(f"OpenCV could not open video: {VIDEO_PATH}")


# --------------------------------------------------
# VIDEO INFORMATION
# --------------------------------------------------

w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
fps = cap.get(cv2.CAP_PROP_FPS)

if fps <= 0:
    fps = 25.0

print(f"Video: {w}x{h} @ {fps:.2f} FPS")


# --------------------------------------------------
# COUNTING REGION
# --------------------------------------------------

# Horizontal counting line across the middle of the video.
# This is better for testing movement/counting first.
region_points = [
    (20, h // 2),
    (w - 20, h // 2),
]


# --------------------------------------------------
# OUTPUT VIDEO
# --------------------------------------------------

fourcc = cv2.VideoWriter_fourcc(*"mp4v")

video_writer = cv2.VideoWriter(
    str(OUTPUT_PATH),
    fourcc,
    fps,
    (w, h),
)

if not video_writer.isOpened():
    raise RuntimeError(f"Could not create output video: {OUTPUT_PATH}")


# --------------------------------------------------
# YOLO26 OBJECT COUNTER
# --------------------------------------------------

counter = solutions.ObjectCounter(
    show=True,
    region=region_points,
    model="yolo26n.pt",

    # Uncomment later if we want a specific tracker:
    # tracker="bytetrack.yaml",

    # Uncomment later if we want specific COCO classes:
    # classes=[0, 2],
)


# --------------------------------------------------
# PROCESS VIDEO
# --------------------------------------------------

frame_number = 0

while cap.isOpened():

    success, frame = cap.read()

    if not success:
        print("Video processing complete.")
        break

    frame_number += 1

    results = counter(frame)

    video_writer.write(results.plot_im)

    if frame_number % 30 == 0:
        print(f"Processed {frame_number} frames")


# --------------------------------------------------
# CLEANUP
# --------------------------------------------------

cap.release()
video_writer.release()
cv2.destroyAllWindows()

print()
print("DONE")
print(f"Processed frames: {frame_number}")
print(f"Output saved to: {OUTPUT_PATH}")