# Load GitHub auth + optional proxy for release scripts (dot-source only).
# Preference order (do NOT put long-lived tokens in the repo tree):
#   1) existing GH_TOKEN / GITHUB_TOKEN environment variable
#   2) GitHub CLI credential store (`gh auth login`)
#   3) short-lived config/github.token (discouraged; revoke after publish)
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Test-GhAuthReady {
    try {
        $null = & gh api user --jq .login 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

if (-not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
    $TokenFile = Join-Path $Root "config\github.token"
    if (Test-Path $TokenFile) {
        Write-Warning "Using config/github.token (discouraged). Prefer: gh auth login, or a temporary GH_TOKEN env var. Revoke file tokens after publish."
        $env:GH_TOKEN = (Get-Content $TokenFile -Raw).Trim()
    }
}

if (-not $env:HTTPS_PROXY) { $env:HTTPS_PROXY = "http://127.0.0.1:7897" }
if (-not $env:HTTP_PROXY) { $env:HTTP_PROXY = "http://127.0.0.1:7897" }

if (-not (Test-GhAuthReady)) {
    Write-Warning "GitHub CLI is not authenticated. Run: gh auth login   OR set a temporary GH_TOKEN for this shell only."
}
