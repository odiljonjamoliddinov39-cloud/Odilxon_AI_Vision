export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function intersectionArea(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

export function iou(a, b) {
  const intersection = intersectionArea(a, b);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

// Intersection over the SMALLER box's area, not the union. Plain IoU
// understates overlap whenever two boxes differ a lot in size: a small box
// almost entirely contained in a much larger one can score well under a
// typical 0.4-0.5 IoU threshold purely because the union is dominated by the
// larger box, even though the smaller one is essentially a duplicate
// detection of the same region. Containment catches that case regardless of
// the size ratio.
export function containment(a, b) {
  const intersection = intersectionArea(a, b);
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 ? intersection / smaller : 0;
}

// Greedy same-label NMS, deduplicating on both IoU and containment (see
// containment() above for why IoU alone misses same-object detections at
// very different scales).
export function suppressOverlapping(items, iouThreshold = 0.45, containmentThreshold = 0.7) {
  const sorted = [...items].sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const candidate of sorted) {
    const isDuplicate = kept.some(
      (existing) =>
        iou(candidate.bbox, existing.bbox) >= iouThreshold ||
        containment(candidate.bbox, existing.bbox) >= containmentThreshold,
    );
    if (!isDuplicate) kept.push(candidate);
  }
  return kept;
}
