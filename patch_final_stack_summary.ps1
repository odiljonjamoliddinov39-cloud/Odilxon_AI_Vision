$ErrorActionPreference = "Stop"

$target = Join-Path $PSScriptRoot "src\vision\engines\modified-dino.js"
if (!(Test-Path $target)) { throw "Cannot find $target" }

$backup = "$target.before-stack-summary-output"
Copy-Item $target $backup -Force

$text = Get-Content $target -Raw

$start = $text.IndexOf("  async analyze({ frame, instruction = {}, debug = false } = {}) {")
if ($start -lt 0) { throw "Could not locate analyze(). No file changed." }

# Find the analyze() closing brace immediately before the class closing brace.
$tailMarker = "`n  }`n}"
$end = $text.IndexOf($tailMarker, $start)
if ($end -lt 0) {
  $tailMarker = "`r`n  }`r`n}"
  $end = $text.IndexOf($tailMarker, $start)
}
if ($end -lt 0) { throw "Could not locate end of analyze(). No file changed." }

$analyze = @'
  async analyze({ frame, instruction = {}, debug = false } = {}) {
    const imagePath = typeof frame === "string" ? frame : frame?.filePath;
    if (!imagePath) throw Object.assign(new Error("Persisted frame required."), { status: 400 });

    const target = String(instruction.target || "").trim();
    if (!target) throw Object.assign(new Error("instruction.target required."), { status: 400 });

    const threshold = Number.isFinite(Number(instruction.threshold))
      ? clamp(Number(instruction.threshold), 0, 1)
      : this.threshold;

    const fullBuffer = await sharp(imagePath).jpeg({ quality: 95 }).toBuffer();
    const meta = await sharp(fullBuffer).metadata();
    const imageSize = { width: meta.width, height: meta.height };

    const started = performance.now();

    // Stage 1: DINO finds STACK ROIs only.
    const roots = nms(
      await detectDino(
        fullBuffer,
        imageSize.width,
        imageSize.height,
        target,
        threshold,
        this.modelDirectory
      ),
      this.nmsIou
    );

    const objects = [];
    const trace = [];
    let physicalCount = 0;

    // Stage 2: decompose/count INSIDE each stack.
    // IMPORTANT: child cells are evidence only. They are NOT returned as UI objects.
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      const result = await decomposeStack(fullBuffer, root, imageSize, target);

      const children = Array.isArray(result?.instances) ? result.instances : [];

      // If decomposition returned only the original DINO root, we have no trustworthy
      // internal split. Treat the stack conservatively as one visible physical item.
      const looksLikeFallback =
        children.length === 1 &&
        children[0]?.bbox?.x === root.bbox.x &&
        children[0]?.bbox?.y === root.bbox.y &&
        children[0]?.bbox?.width === root.bbox.width &&
        children[0]?.bbox?.height === root.bbox.height;

      const stackCount = Math.max(
        1,
        looksLikeFallback ? 1 : children.length
      );

      physicalCount += stackCount;

      // ONE object for the dashboard: original DINO stack bbox + internal count.
      objects.push({
        id: `stack_${i + 1}`,
        label: `${target} x${stackCount}`,
        baseLabel: target,
        kind: "stack",
        confidence: root.confidence,
        bbox: { ...root.bbox },
        count: stackCount,
        stackCount,
        childCount: stackCount,

        // Keep child geometry available to API/debug consumers, but the normal
        // renderer sees only this single stack object.
        decomposition: {
          count: stackCount,
          instances: children.map((child, childIndex) => ({
            id: `stack_${i + 1}_child_${childIndex + 1}`,
            bbox: child.bbox,
            confidence: child.confidence ?? root.confidence,
          })),
        },
      });

      trace.push({
        stack: i + 1,
        root: root.bbox,
        stackCount,
        ...result.debug,
      });
    }

    const inferenceMs = Math.round(performance.now() - started);

    return {
      engine: this.name,

      // UI draws exactly one bbox per DINO stack.
      objects,

      // This is the useful production count: sum of physical boxes inside stacks.
      count: physicalCount,

      confidence: objects.length
        ? objects.reduce((sum, x) => sum + Number(x.confidence || 0), 0) / objects.length
        : null,

      evidence: [
        { type: "dino_stack_roots", value: roots.length },
        { type: "physical_box_count", value: physicalCount },
        {
          type: "stack_counts",
          value: objects.map(x => ({
            id: x.id,
            count: x.stackCount,
          })),
        },
      ],

      inferenceMs,

      debug: debug
        ? {
            mode: "stack_bbox_with_internal_count",
            decompositionTrace: trace,
          }
        : undefined,
    };
  }
'@

$patched = $text.Substring(0, $start) + $analyze + $text.Substring($end + $tailMarker.Length - 1)
Set-Content $target $patched -Encoding UTF8

Write-Host ""
Write-Host "PATCHED: $target"
Write-Host "BACKUP : $backup"
Write-Host ""
Write-Host "FINAL OUTPUT CONTRACT:"
Write-Host "  DINO bbox = one visible stack rectangle"
Write-Host "  decomposer children = internal evidence only"
Write-Host "  object label = baget box xN"
Write-Host "  result.count = sum of boxes across stacks"
Write-Host ""
Write-Host "Run:"
Write-Host "  npm.cmd start"
