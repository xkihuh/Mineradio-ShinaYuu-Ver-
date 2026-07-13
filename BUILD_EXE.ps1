$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[ShinaYuu Music] Installing dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

Write-Host "[ShinaYuu Music] Building Electron + NSIS installer..." -ForegroundColor Cyan
npm run build:win
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed." }

$setup = Join-Path $PSScriptRoot "dist\ShinaYuu-Music-1.1.3.1-Setup.exe"
Write-Host ""
Write-Host "Windows installer created:" -ForegroundColor Green
Write-Host $setup -ForegroundColor Yellow
