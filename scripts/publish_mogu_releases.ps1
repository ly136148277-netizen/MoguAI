# Publish 蘑菇AI v1.4.0+ installers to GitHub Releases (auto-update CDN)
# Usage: .\scripts\publish_mogu_releases.ps1 [-Version 1.4.0] [-RepoName mogu-ai-releases]
param(
    [string]$Version = "",
    [string]$RepoName = "mogu-ai-releases",
    [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Pkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $Pkg.version }

$Setup = Get-ChildItem (Join-Path $Root "dist") -Filter "*Setup $Version.exe" | Select-Object -First 1
$Portable = Get-ChildItem (Join-Path $Root "dist") -Filter "* $Version.exe" | Where-Object { $_.Name -notmatch "Setup" } | Select-Object -First 1
$LatestYml = Join-Path $Root "dist\latest.yml"
$BlockMap = Get-ChildItem (Join-Path $Root "dist") -Filter "*Setup $Version.exe.blockmap" | Select-Object -First 1

if (-not $Setup -or -not (Test-Path $LatestYml)) {
    Write-Host "Missing dist artifacts for $Version — run npm run dist first" -ForegroundColor Red
    exit 1
}
$Setup = $Setup.FullName
if ($Portable) { $Portable = $Portable.FullName }
if ($BlockMap) { $BlockMap = $BlockMap.FullName }

Write-Host "[1/4] Version $Version artifacts OK" -ForegroundColor Cyan

if ($SkipPush) {
    Write-Host "[2/4] Skip push. Files ready in dist/" -ForegroundColor Yellow
    exit 0
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "gh CLI not found." -ForegroundColor Red
    exit 1
}

$user = (gh api user -q .login).Trim()
$fullRepo = "$user/$RepoName"
Write-Host "[2/4] Ensure repo $fullRepo ..." -ForegroundColor Cyan

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$null = gh repo view $fullRepo 2>&1
$repoExists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEap

if (-not $repoExists) {
    gh repo create $RepoName --public --description "蘑菇AI desktop releases (auto-update CDN)"
}

$tag = "v$Version"
Write-Host "[3/4] Create release $tag ..." -ForegroundColor Cyan
$assets = @($Setup, $LatestYml)
if (Test-Path $BlockMap) { $assets += $BlockMap }
if (Test-Path $Portable) { $assets += $Portable }

gh release upload $tag $assets --repo $fullRepo --clobber 2>$null
if ($LASTEXITCODE -ne 0) {
    gh release create $tag --repo $fullRepo --title "MoguAI $Version" --notes "Desktop release for auto-update." $assets
}

Write-Host "[4/4] Set config/update.json to GitHub provider:" -ForegroundColor Cyan
$updateJson = Join-Path $Root "config\update.json"
@{
    provider = "github"
    owner    = $user
    repo     = $RepoName
    url      = ""
    notes    = "GitHub Releases auto-update. Release: $fullRepo/releases/tag/$tag"
} | ConvertTo-Json | Set-Content $updateJson -Encoding UTF8

Write-Host "  https://github.com/$fullRepo/releases/tag/$tag" -ForegroundColor Green
Write-Host "Done." -ForegroundColor Green
