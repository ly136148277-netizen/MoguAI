param(
    [string]$DistDir = "dist-test-signed",
    [switch]$RequireTrustedSignature,
    [string]$Output = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
$ResolvedDist = [IO.Path]::GetFullPath((Join-Path $Root $DistDir))
$Version = (node -p "require('./package.json').version").Trim()
$ChannelFileName = if ($Version -match "-rc\.") { "rc.yml" } else { "latest.yml" }
$Installer = Join-Path $ResolvedDist "MOGU-AI-Setup-$Version.exe"
$Portable = Join-Path $ResolvedDist "MOGU AI $Version.exe"
$BlockMap = "$Installer.blockmap"
$ChannelFile = Join-Path $ResolvedDist $ChannelFileName
if (-not $Output) { $Output = Join-Path $ResolvedDist "signed-e2e-report.json" }

foreach ($File in @($Installer, $Portable, $BlockMap, $ChannelFile)) {
    if (-not (Test-Path $File)) { throw "Missing release file: $File" }
}

$SignatureRows = @()
foreach ($File in @($Installer, $Portable)) {
    $Signature = Get-AuthenticodeSignature $File
    if (-not $Signature.SignerCertificate) { throw "Missing Authenticode signature: $File" }
    if ($Signature.Status -eq "NotSigned" -or $Signature.Status -eq "HashMismatch") {
        throw "Invalid Authenticode signature: $File ($($Signature.Status))"
    }
    if ($RequireTrustedSignature -and $Signature.Status -ne "Valid") {
        throw "Trusted signature required but status is $($Signature.Status): $File"
    }
    $SignatureRows += [ordered]@{
        file = (Split-Path -Leaf $File)
        status = [string]$Signature.Status
        subject = $Signature.SignerCertificate.Subject
        thumbprint = $Signature.SignerCertificate.Thumbprint
    }
}

$ChannelText = Get-Content $ChannelFile -Raw
if ($ChannelText -notmatch "(?m)^version:\s*$([regex]::Escape($Version))\s*$") {
    throw "$ChannelFileName version does not match $Version"
}
if ($ChannelText -notmatch [regex]::Escape((Split-Path -Leaf $Installer))) {
    throw "$ChannelFileName does not reference the installer"
}

$Suffix = [guid]::NewGuid().ToString("n").Substring(0, 8)
$InstallDir = Join-Path $env:TEMP "MoguSignedInstall-$Suffix"
$Profile = Join-Path $env:TEMP "MoguSignedProfile-$Suffix"
New-Item -ItemType Directory -Path $Profile | Out-Null
$InstallExit = $null
$UninstallExit = $null
$RuntimeStarted = $false
$ProfileClean = $false
$ProfileRetained = $false
$InstallPayloadRemoved = $false

try {
    $Install = Start-Process `
        -FilePath $Installer `
        -ArgumentList "/S", "/D=$InstallDir" `
        -Wait `
        -PassThru
    $InstallExit = $Install.ExitCode
    if ($InstallExit -ne 0) { throw "Installer failed: $InstallExit" }

    $InstalledExe = Join-Path $InstallDir "MOGU AI.exe"
    if (-not (Test-Path $InstalledExe)) { throw "Installed executable missing" }
    $InstalledSignature = Get-AuthenticodeSignature $InstalledExe
    if (-not $InstalledSignature.SignerCertificate) { throw "Installed executable signature missing" }
    if ($RequireTrustedSignature -and $InstalledSignature.Status -ne "Valid") {
        throw "Installed executable signature is not trusted: $($InstalledSignature.Status)"
    }

    $env:MOGU_USER_DATA = $Profile
    $App = Start-Process -FilePath $InstalledExe -PassThru
    Start-Sleep -Seconds 12
    if ($App.HasExited) { throw "Installed app exited early: $($App.ExitCode)" }
    $RuntimeStarted = $true

    $SettingsPath = Join-Path $Profile "settings.json"
    $LogPath = Join-Path $Profile "logs\app.log"
    $Settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json
    $Log = Get-Content $LogPath -Raw
    $SessionCount = @(Get-ChildItem (Join-Path $Profile "chat-sessions") -File -ErrorAction SilentlyContinue).Count
    $PrivateFiles = @("tasks.json", "permission-grants.json", "secrets.json", "studio-pipeline.json") |
        Where-Object { Test-Path (Join-Path $Profile $_) }
    $ProfileClean =
        ($SessionCount -eq 0) -and
        ($PrivateFiles.Count -eq 0) -and
        ($Settings.autoStartPai -eq $false) -and
        ([string]::IsNullOrEmpty($Settings.paiRoot)) -and
        ($Settings.openclawFallbackToPai -eq $false) -and
        ($Log -notmatch "projects.PAI") -and
        ($Log -notmatch "HTTP_PROXY")
    if (-not $ProfileClean) { throw "Clean-profile assertions failed" }

    Get-Process -Name "MOGU AI" -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $InstalledExe } |
        Stop-Process -Force
    Start-Sleep -Seconds 2
    $env:MOGU_USER_DATA = $null

    $Uninstaller = Get-ChildItem $InstallDir -Filter "*ninstall*.exe" -File | Select-Object -First 1
    if (-not $Uninstaller) { throw "Uninstaller missing" }
    $Uninstall = Start-Process -FilePath $Uninstaller.FullName -ArgumentList "/S" -Wait -PassThru
    $UninstallExit = $Uninstall.ExitCode
    if ($UninstallExit -ne 0) { throw "Uninstaller failed: $UninstallExit" }
    Start-Sleep -Seconds 5
    $ProfileRetained = Test-Path $SettingsPath
    $InstallPayloadRemoved = @(Get-ChildItem $InstallDir -Force -ErrorAction SilentlyContinue).Count -eq 0
    if (-not $ProfileRetained -or -not $InstallPayloadRemoved) {
        throw "Uninstall retention/cleanup assertions failed"
    }

    $Report = [ordered]@{
        schemaVersion = 1
        kind = "signed-installer-e2e-report"
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        version = $Version
        result = "pass"
        signatureRequirement = if ($RequireTrustedSignature) { "trusted/Valid" } else { "embedded/test-signature" }
        signatures = $SignatureRows
        updateMetadata = [ordered]@{
            channelFile = $ChannelFileName
            versionMatches = $true
            installerMatches = $true
            blockmapPresent = $true
        }
        installExitCode = $InstallExit
        runtimeStarted = $RuntimeStarted
        cleanProfile = $ProfileClean
        ownerDataImported = $false
        uninstallExitCode = $UninstallExit
        userDataRetained = $ProfileRetained
        installPayloadRemoved = $InstallPayloadRemoved
        publicReleaseEligible = $false
    }
    [IO.File]::WriteAllText(
        [IO.Path]::GetFullPath($Output),
        (($Report | ConvertTo-Json -Depth 10) + "`n"),
        [Text.UTF8Encoding]::new($false)
    )
    Write-Host "[signed-e2e] PASS — $Output"
}
finally {
    $env:MOGU_USER_DATA = $null
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path $Profile) { Remove-Item $Profile -Recurse -Force -ErrorAction SilentlyContinue }
}
