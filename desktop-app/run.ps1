# Starts CODStats v4 from this folder.
#   .\run.ps1                 data in Documents\CODStats-v4 (first start copies Documents\CODStats, read-only)
#   .\run.ps1 -DataFolder X   use another data folder
param([string]$DataFolder = "")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# This folder's own environment first, then the environments earlier CODStats builds made.
# The live v3 app's environment is deliberately not used.
$candidates = @(
    (Join-Path $PSScriptRoot ".venv\Scripts\python.exe"),
    "$env:USERPROFILE\Desktop\CodStatsFinal\app\.venv\Scripts\python.exe",
    "$env:USERPROFILE\Desktop\CODStats-Combined\app\.venv\Scripts\python.exe"
)
$check = "import importlib.util as u, sys; sys.exit(0 if all(u.find_spec(m) for m in ('PySide6.QtWebEngineWidgets','PySide6.QtMultimedia','cv2','paddleocr')) else 1)"
$python = $null
$ErrorActionPreference = "Continue"
foreach ($c in $candidates) {
    if (Test-Path $c) {
        & $c -c $check 2>$null
        if ($LASTEXITCODE -eq 0) { $python = $c; break }
    }
}
$ErrorActionPreference = "Stop"
if (-not $python) { throw "No Python environment with PySide6 and PaddleOCR was found. Run .\setup.ps1 once, then try again." }
Write-Host "Using Python: $python"

# Reuse OCR models that are already on this PC, so nothing is downloaded again.
foreach ($m in @((Join-Path $PSScriptRoot "models"), "$env:USERPROFILE\Desktop\CodStatsFinal\app\bundled-models",
                 "$env:USERPROFILE\Desktop\CODStats-Combined\app\bundled-models")) {
    if (Test-Path $m) { $env:PADDLE_PDX_CACHE_HOME = $m; Write-Host "OCR models: $m"; break }
}
if (-not $env:TESSERACT_CMD -and (Test-Path "C:\Program Files\Tesseract-OCR\tesseract.exe")) {
    $env:TESSERACT_CMD = "C:\Program Files\Tesseract-OCR\tesseract.exe"
}
if ($DataFolder) { $env:CODSTATS_DATA_DIR = $DataFolder }
& $python app.py
