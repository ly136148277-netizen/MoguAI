# Publish MOGU AI installers to GitHub Releases (auto-update CDN)
# Usage: .\scripts\publish_mogu_releases.ps1 [-Version 1.5.3] [-RepoName mogu-ai-releases]
param(
    [string]$Version = "",
    [string]$RepoName = "mogu-ai-releases",
    [string]$Notes = "",
    [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not $Version) {
    $Version = (node -e "console.log(require('./package.json').version)").Trim()
}
if (-not $Version) {
    Write-Host "Cannot read version from package.json" -ForegroundColor Red
    exit 1
}

$Dist = Join-Path $Root "dist"
$LatestYml = Join-Path $Dist "latest.yml"

# Prefer current artifactName: MOGU-AI-Setup-${version}.exe
$SetupCandidates = @(
    (Join-Path $Dist "MOGU-AI-Setup-$Version.exe"),
    (Join-Path $Dist "MOGU AI Setup $Version.exe")
) + @(Get-ChildItem $Dist -Filter "*Setup*$Version.exe" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })

$Setup = $SetupCandidates | Where-Object { $_ -and (Test-Path $_) -and ($_ -notmatch '\.blockmap$') } | Select-Object -First 1

$BlockMapCandidates = @(
    "$Setup.blockmap",
    (Join-Path $Dist "MOGU-AI-Setup-$Version.exe.blockmap")
)
$BlockMap = $BlockMapCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

$Portable = @(
    (Join-Path $Dist "MOGU AI $Version.exe"),
    (Join-Path $Dist "MOGU-AI-$Version.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $Setup -or -not (Test-Path $LatestYml)) {
    Write-Host "Missing dist artifacts for $Version — run npm run dist first" -ForegroundColor Red
    Write-Host "  expected: dist/MOGU-AI-Setup-$Version.exe + dist/latest.yml"
    exit 1
}

Write-Host "[1/4] Version $Version artifacts OK" -ForegroundColor Cyan
Write-Host "  setup: $Setup"
if ($BlockMap) { Write-Host "  blockmap: $BlockMap" }
if ($Portable) { Write-Host "  portable: $Portable" }

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
    gh repo create $RepoName --public --description "MOGU AI desktop releases (auto-update CDN)"
}

$tag = "v$Version"
if (-not $Notes) {
    $Notes = @"
## MOGU AI $Version

- 圆形蘑菇桌面图标
- 安装时可自选路径并确认安装（非静默一键）
- 安装完成后自动创建桌面快捷方式
- 创作台 / 视频合成等 1.5 能力

下载安装包：``MOGU-AI-Setup-$Version.exe``
"@
}

Write-Host "[3/4] Publish release $tag ..." -ForegroundColor Cyan
$assets = @($Setup, $LatestYml)
if ($BlockMap) { $assets += $BlockMap }
if ($Portable) { $assets += $Portable }

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
gh release view $tag --repo $fullRepo 2>$null | Out-Null
$releaseExists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEap

if ($releaseExists) {
    gh release upload $tag @assets --repo $fullRepo --clobber
} else {
    gh release create $tag --repo $fullRepo --title "MOGU AI $Version" --notes $Notes @assets
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Release publish failed" -ForegroundColor Red
    exit 1
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
Write-Host "  https://github.com/$fullRepo/releases/latest" -ForegroundColor Green
Write-Host "Done. Old releases (e.g. v1.4.0) are kept." -ForegroundColor Green
