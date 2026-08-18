$ErrorActionPreference = "Stop"

$path = Join-Path $PSScriptRoot "src\config.js"
if (!(Test-Path $path)) { throw "Cannot find $path" }

Copy-Item $path "$path.before-analysis-migration" -Force

$text = Get-Content $path -Raw

$old = @'
  cfg.vision ||= {};
  cfg.vision.engine ||= "grounding_dino";
  cfg.vision.threshold = numericThreshold(cfg.vision.threshold, 0.35);
  cfg.vision.debug = cfg.vision.debug === true;
  cfg.vision.engines ||= {};
  cfg.vision.engines.grounding_dino ||= {};
  cfg.vision.engines.grounding_dino.threshold = numericThreshold(
    cfg.vision.engines.grounding_dino.threshold,
    cfg.vision.threshold,
  );
  cfg.vision.engines.modified_dino ||= {};
'@

$new = @'
  // Backward compatibility with the project's existing "analysis" config.
  // IMPORTANT: migrate BEFORE applying vision defaults, otherwise
  // "grounding_dino" wins even when analysis.provider is "modified_dino".
  cfg.vision ||= {};
  const legacyAnalysis = cfg.analysis || {};

  if (!cfg.vision.engine && legacyAnalysis.provider) {
    cfg.vision.engine = legacyAnalysis.provider;
  }

  if (cfg.vision.threshold == null && legacyAnalysis.openVocabularyThreshold != null) {
    cfg.vision.threshold = legacyAnalysis.openVocabularyThreshold;
  }

  cfg.vision.engines ||= {};

  if (!cfg.vision.engines.modified_dino && legacyAnalysis.modifiedDino) {
    cfg.vision.engines.modified_dino = { ...legacyAnalysis.modifiedDino };
  }

  cfg.vision.engine ||= "grounding_dino";
  cfg.vision.threshold = numericThreshold(cfg.vision.threshold, 0.35);
  cfg.vision.debug = cfg.vision.debug === true || legacyAnalysis.debug === true;

  cfg.vision.engines.grounding_dino ||= {};
  cfg.vision.engines.grounding_dino.threshold = numericThreshold(
    cfg.vision.engines.grounding_dino.threshold,
    cfg.vision.threshold,
  );

  cfg.vision.engines.modified_dino ||= {};
  cfg.vision.engines.modified_dino.threshold = numericThreshold(
    cfg.vision.engines.modified_dino.threshold,
    cfg.vision.threshold,
  );
'@

if (!$text.Contains($old)) {
  throw "Expected config block was not found. No file was changed."
}

$text = $text.Replace($old, $new)
Set-Content $path $text -Encoding UTF8

Write-Host "PATCHED: $path"
Write-Host "BACKUP : $path.before-analysis-migration"
Write-Host ""
Write-Host "Verify with:"
Write-Host 'node -e "import(''./src/config.js'').then(m=>console.log(JSON.stringify(m.loadConfig().vision,null,2)))"'
