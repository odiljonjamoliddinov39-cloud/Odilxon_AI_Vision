import sharp from "sharp";

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  ];
}

function smooth(signal, radius = 2) {
  return signal.map((_, i) => {
    let total = 0;
    let count = 0;

    for (
      let j = Math.max(0, i - radius);
      j <= Math.min(signal.length - 1, i + radius);
      j++
    ) {
      total += signal[j];
      count++;
    }

    return count ? total / count : 0;
  });
}

function normalize(signal) {
  const m = median(signal);
  const mad =
    median(signal.map((value) => Math.abs(value - m))) || 1;

  return signal.map((value) =>
    Math.max(0, (value - m) / (mad * 3))
  );
}

function findPeaks(signal, minimumDistance, threshold = 0.35) {
  const candidates = [];

  for (let i = 2; i < signal.length - 2; i++) {
    if (
      signal[i] >= threshold &&
      signal[i] >= signal[i - 1] &&
      signal[i] >= signal[i + 1]
    ) {
      candidates.push({
        position: i,
        strength: signal[i],
      });
    }
  }

  candidates.sort((a, b) => b.strength - a.strength);

  const accepted = [];

  for (const candidate of candidates) {
    if (
      accepted.every(
        (existing) =>
          Math.abs(existing.position - candidate.position) >=
          minimumDistance
      )
    ) {
      accepted.push(candidate);
    }
  }

  return accepted.sort((a, b) => a.position - b.position);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function countIndividualBoxes({
  imageBuffer,
  root,
  imageSize,
  target,
}) {
  const padX = Math.round(root.bbox.width * 0.02);
  const padY = Math.round(root.bbox.height * 0.02);

  const left = Math.max(0, root.bbox.x - padX);
  const top = Math.max(0, root.bbox.y - padY);

  const width = Math.min(
    imageSize.width - left,
    root.bbox.width + padX * 2
  );

  const height = Math.min(
    imageSize.height - top,
    root.bbox.height + padY * 2
  );

  if (width < 80 || height < 60) {
    return {
      instances: [root],
      debug: {
        decision: "roi_too_small",
      },
    };
  }

  const { data, info } = await sharp(imageBuffer)
    .extract({
      left,
      top,
      width,
      height,
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;

  /*
   * gx = vertical-edge evidence
   * gy = horizontal-edge evidence
   */
  const gx = new Float32Array(W * H);
  const gy = new Float32Array(W * H);

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const index = y * W + x;

      gx[index] = Math.abs(
        data[y * W + (x + 1)] -
        data[y * W + (x - 1)]
      );

      gy[index] = Math.abs(
        data[(y + 1) * W + x] -
        data[(y - 1) * W + x]
      );
    }
  }

  /*
   * Find strong physical seams.
   */
  const verticalProjection = new Array(W).fill(0);
  const horizontalProjection = new Array(H).fill(0);

  for (let x = 1; x < W - 1; x++) {
    const values = [];

    for (let y = Math.round(H * 0.05); y < H * 0.95; y += 2) {
      values.push(gx[y * W + x]);
    }

    verticalProjection[x] = percentile(values, 0.72);
  }

  for (let y = 1; y < H - 1; y++) {
    const values = [];

    for (let x = Math.round(W * 0.05); x < W * 0.95; x += 2) {
      values.push(gy[y * W + x]);
    }

    horizontalProjection[y] = percentile(values, 0.72);
  }

  const vSignal = normalize(
    smooth(verticalProjection, Math.max(1, Math.round(W * 0.004)))
  );

  const hSignal = normalize(
    smooth(horizontalProjection, Math.max(1, Math.round(H * 0.004)))
  );

  /*
   * We are finding boundaries here — NOT counting cells yet.
   */
  let xLines = findPeaks(
    vSignal,
    Math.max(8, Math.round(W * 0.055)),
    0.30
  ).map((x) => x.position);

  let yLines = findPeaks(
    hSignal,
    Math.max(8, Math.round(H * 0.055)),
    0.30
  ).map((x) => x.position);

  /*
   * ROI perimeter is allowed as an external box edge.
   */
  xLines = [0, ...xLines.filter((x) => x > 5 && x < W - 5), W];
  yLines = [0, ...yLines.filter((y) => y > 5 && y < H - 5), H];

  function verticalSideSupport(x, y1, y2) {
    if (x <= 1 || x >= W - 2) return 0.72;

    const values = [];

    for (let y = y1 + 2; y < y2 - 2; y += 2) {
      let best = 0;

      for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.max(1, Math.min(W - 2, x + dx));
        best = Math.max(best, gx[y * W + xx]);
      }

      values.push(best);
    }

    return percentile(values, 0.65) / 40;
  }

  function horizontalSideSupport(y, x1, x2) {
    if (y <= 1 || y >= H - 2) return 0.72;

    const values = [];

    for (let x = x1 + 2; x < x2 - 2; x += 2) {
      let best = 0;

      for (let dy = -2; dy <= 2; dy++) {
        const yy = Math.max(1, Math.min(H - 2, y + dy));
        best = Math.max(best, gy[yy * W + x]);
      }

      values.push(best);
    }

    return percentile(values, 0.65) / 40;
  }

  function interiorVariance(x1, y1, x2, y2) {
    const values = [];

    const sx = Math.max(1, Math.floor((x2 - x1) / 12));
    const sy = Math.max(1, Math.floor((y2 - y1) / 8));

    for (let y = y1 + 2; y < y2 - 2; y += sy) {
      for (let x = x1 + 2; x < x2 - 2; x += sx) {
        values.push(data[y * W + x]);
      }
    }

    if (!values.length) return 0;

    const m = average(values);

    return average(
      values.map((value) => (value - m) * (value - m))
    );
  }

  const instances = [];
  const rejected = [];

  /*
   * Candidate rectangle != box.
   *
   * Every candidate is validated separately using its four sides.
   */
  for (let yi = 0; yi < yLines.length - 1; yi++) {
    for (let xi = 0; xi < xLines.length - 1; xi++) {
      const x1 = Math.round(xLines[xi]);
      const x2 = Math.round(xLines[xi + 1]);
      const y1 = Math.round(yLines[yi]);
      const y2 = Math.round(yLines[yi + 1]);

      const boxWidth = x2 - x1;
      const boxHeight = y2 - y1;

      if (
        boxWidth < W * 0.06 ||
        boxHeight < H * 0.06
      ) {
        continue;
      }

      const leftEdge = verticalSideSupport(x1, y1, y2);
      const rightEdge = verticalSideSupport(x2, y1, y2);
      const topEdge = horizontalSideSupport(y1, x1, x2);
      const bottomEdge = horizontalSideSupport(y2, x1, x2);

      const sides = [
        leftEdge,
        rightEdge,
        topEdge,
        bottomEdge,
      ];

      const visibleSides = sides.filter(
        (value) => value >= 0.28
      ).length;

      const edgeScore = average(
        sides.map((value) => Math.min(1, value))
      );

      const variance = interiorVariance(
        x1,
        y1,
        x2,
        y2
      );

      /*
       * Main rule:
       *
       * 4 edges visible  -> accept
       * 3 edges visible  -> accept, infer missing edge
       * 2 or fewer       -> reject for now
       *
       * This prevents us from inventing boxes from an empty lattice.
       */
      const accepted =
        variance >= 16 &&
        (
          visibleSides >= 3 ||
          (visibleSides === 2 && edgeScore >= 0.52)
        );

      const evidence = {
        left: leftEdge,
        right: rightEdge,
        top: topEdge,
        bottom: bottomEdge,
        visibleSides,
        edgeScore,
        variance,
      };

      if (!accepted) {
        rejected.push({
          bbox: { x1, y1, x2, y2 },
          evidence,
        });

        continue;
      }

      instances.push({
        id: `${root.id}_box_${instances.length + 1}`,
        label: target,

        confidence: Math.min(
          root.confidence,
          Math.max(
            0.25,
            root.confidence *
              (0.65 + Math.min(0.35, edgeScore))
          )
        ),

        bbox: {
          x: left + x1,
          y: top + y1,
          width: boxWidth,
          height: boxHeight,
        },

        edgeEvidence: evidence,

        inferredEdges: Math.max(
          0,
          4 - visibleSides
        ),
      });
    }
  }

  /*
   * DINO stack stays as fallback if physical-box evidence is insufficient.
   */
  if (instances.length < 2) {
    return {
      instances: [root],

      debug: {
        decision: "keep_dino_stack",
        candidateXEdges: xLines,
        candidateYEdges: yLines,
        acceptedBoxes: instances.length,
        rejectedBoxes: rejected.length,
      },
    };
  }

  return {
    instances,

    debug: {
      decision: "individual_edge_instances",
      candidateXEdges: xLines,
      candidateYEdges: yLines,
      acceptedBoxes: instances.length,
      rejectedBoxes: rejected.length,

      boxes: instances.map((box) => ({
        id: box.id,
        bbox: box.bbox,
        visibleSides:
          box.edgeEvidence.visibleSides,
        inferredEdges:
          box.inferredEdges,
        edgeScore:
          box.edgeEvidence.edgeScore,
      })),
    },
  };
}
