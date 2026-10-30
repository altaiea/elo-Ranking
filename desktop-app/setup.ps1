# One-time setup: creates .venv in this folder with everything the app needs.
# Nothing outside this folder is changed (Python and Tesseract are installed with winget if missing).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Python = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
if (-not (Test-Path $Python)) {
    Write-Host "Installing Python 3.12..."
    winget install --id Python.Python.3.12 --exact --scope user --accept-package-agreements --accept-source-agreements
}
if (-not (Test-Path "C:\Program Files\Tesseract-OCR\tesseract.exe")) {
    Write-Host "Installing Tesseract (score fallback)..."
    winget install --id UB-Mannheim.TesseractOCR --exact --accept-package-agreements --accept-source-agreements
}

if (-not (Test-Path ".venv\Scripts\python.exe")) { & $Python -m venv .venv }
.\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel
.\.venv\Scripts\python.exe -m pip install paddlepaddle==3.3.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Write-Host "Setup complete. Start the app with 'Start CODStats.cmd' (or .\run.ps1)." -ForegroundColor Green
