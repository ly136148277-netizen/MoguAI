# Publish GGUF model catalog to mogu-map (desktop CDN — NOT PAI ComfyUI workflows)
# Usage: .\scripts\publish_model_catalog.ps1 [-RepoName mogu-map] [-SkipPush]
param(
    [string]$RepoName = "mogu-map",
    [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$CatalogSrc = Join-Path $Root "catalog\models.json"
if (-not (Test-Path $CatalogSrc)) {
    Write-Host "Missing $CatalogSrc" -ForegroundColor Red
    exit 1
}

$Publish = Join-Path $Root ".publish-mogu-catalog"
if (Test-Path $Publish) { Remove-Item $Publish -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $Publish "catalog") -Force | Out-Null
Copy-Item $CatalogSrc (Join-Path $Publish "catalog\models.json")

Write-Host "[1/3] Prepared GGUF model catalog:" -ForegroundColor Cyan
Get-ChildItem (Join-Path $Publish "catalog") | ForEach-Object { Write-Host "  catalog/$($_.Name)" }

if ($SkipPush) {
    Write-Host "[2/3] Skip push (-SkipPush). Dir: $Publish" -ForegroundColor Yellow
    Write-Host "CDN URL after push:" -ForegroundColor Yellow
    Write-Host "  https://cdn.jsdelivr.net/gh/<user>/$RepoName@main/catalog/models.json"
    exit 0
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "gh CLI not found." -ForegroundColor Red
    exit 1
}

$user = (gh api user -q .login).Trim()
Write-Host "[2/3] Push catalog/ to $user/$RepoName (merge into existing repo)..." -ForegroundColor Cyan

$CloneDir = Join-Path $env:TEMP "mogu-map-catalog-$(Get-Random)"
if (Test-Path $CloneDir) { Remove-Item $CloneDir -Recurse -Force }
git clone --depth 1 "https://github.com/$user/$RepoName.git" $CloneDir
New-Item -ItemType Directory -Path (Join-Path $CloneDir "catalog") -Force | Out-Null
Copy-Item $CatalogSrc (Join-Path $CloneDir "catalog\models.json") -Force
Push-Location $CloneDir
git add catalog/models.json
git -c user.name="mogu-ai-desktop" -c user.email="desktop@mogu-ai.local" commit -m "Update GGUF model catalog (desktop CDN)" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "No catalog changes to commit." -ForegroundColor Yellow
    Pop-Location
    Remove-Item $CloneDir -Recurse -Force
    exit 0
}
git push origin main
Pop-Location
Remove-Item $CloneDir -Recurse -Force

$cdn = "https://cdn.jsdelivr.net/gh/$user/$RepoName@main/catalog/models.json"
Write-Host "[3/3] Done." -ForegroundColor Green
Write-Host "  CDN: $cdn"
Write-Host "  config/repository.json syncUrl should match this URL."
