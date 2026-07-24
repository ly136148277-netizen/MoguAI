param(
    [string]$OutputDir = "dist-test-signed"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Version = (node -p "require('./package.json').version").Trim()
if (-not $Version) { throw "Cannot read package version" }

$ResolvedOutput = [IO.Path]::GetFullPath((Join-Path $Root $OutputDir))
$StageDir = "$ResolvedOutput-prepackaged"
$Subject = "CN=MOGU AI Internal Test Only"
$Certificate = $null

function Sign-TestFile([string]$FilePath, $SigningCertificate) {
    if (-not (Test-Path $FilePath)) { throw "Missing file to sign: $FilePath" }
    $Signature = Set-AuthenticodeSignature `
        -FilePath $FilePath `
        -Certificate $SigningCertificate `
        -HashAlgorithm SHA256
    if (-not $Signature.SignerCertificate) { throw "No embedded signature after signing: $FilePath" }
    if ($Signature.Status -eq "HashMismatch" -or $Signature.Status -eq "NotSigned") {
        throw "Invalid test signature for ${FilePath}: $($Signature.Status)"
    }
    return $Signature
}

function Get-Sha512Base64([string]$FilePath) {
    $Stream = [IO.File]::OpenRead($FilePath)
    try {
        $Hasher = [Security.Cryptography.SHA512]::Create()
        try {
            return [Convert]::ToBase64String($Hasher.ComputeHash($Stream))
        }
        finally {
            $Hasher.Dispose()
        }
    }
    finally {
        $Stream.Dispose()
    }
}

try {
    Write-Host "[test-signing] Building prepackaged application"
    & npx electron-builder --dir "--config.directories.output=$StageDir"
    if ($LASTEXITCODE -ne 0) { throw "prepackaged build failed: $LASTEXITCODE" }

    $Certificate = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $Subject `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyAlgorithm RSA `
        -KeyLength 3072 `
        -HashAlgorithm SHA256 `
        -KeyExportPolicy NonExportable `
        -NotAfter (Get-Date).AddDays(7)

    $PrepackagedExe = Join-Path $StageDir "win-unpacked\MOGU AI.exe"
    $PrepackagedSignature = Sign-TestFile $PrepackagedExe $Certificate

    Write-Host "[test-signing] Packaging the signed application"
    & npx electron-builder `
        --win nsis portable `
        --prepackaged (Join-Path $StageDir "win-unpacked") `
        "--config.directories.output=$ResolvedOutput"
    if ($LASTEXITCODE -ne 0) { throw "installer build failed: $LASTEXITCODE" }

    $Installer = Join-Path $ResolvedOutput "MOGU-AI-Setup-$Version.exe"
    $Portable = Join-Path $ResolvedOutput "MOGU AI $Version.exe"
    $InstallerSignature = Sign-TestFile $Installer $Certificate
    $PortableSignature = Sign-TestFile $Portable $Certificate

    # Signing changes the installer bytes. Regenerate all metadata that binds
    # those bytes so differential updates cannot reference the unsigned build.
    $BlockMap = "$Installer.blockmap"
    & "$Root\node_modules\app-builder-bin\win\x64\app-builder.exe" `
        blockmap `
        "--input=$Installer" `
        "--output=$BlockMap"
    if ($LASTEXITCODE -ne 0) { throw "blockmap generation failed: $LASTEXITCODE" }

    $ChannelName = if ($Version -match "-rc\.") { "rc.yml" } else { "latest.yml" }
    $ChannelPath = Join-Path $ResolvedOutput $ChannelName
    $InstallerName = Split-Path -Leaf $Installer
    $InstallerSize = (Get-Item $Installer).Length
    $InstallerSha512 = Get-Sha512Base64 $Installer
    $ReleaseDate = (Get-Date).ToUniversalTime().ToString("o")
    $ChannelYaml = @"
version: $Version
files:
  - url: $InstallerName
    sha512: $InstallerSha512
    size: $InstallerSize
path: $InstallerName
sha512: $InstallerSha512
releaseDate: '$ReleaseDate'
"@
    [IO.File]::WriteAllText(
        $ChannelPath,
        $ChannelYaml.Replace("`r`n", "`n") + "`n",
        [Text.UTF8Encoding]::new($false)
    )

    $FinalUnpacked = Join-Path $ResolvedOutput "win-unpacked"
    if (Test-Path $FinalUnpacked) { Remove-Item $FinalUnpacked -Recurse -Force }
    Copy-Item (Join-Path $StageDir "win-unpacked") $FinalUnpacked -Recurse

    $Rows = @(
        [ordered]@{
            path = "prepackaged/MOGU AI.exe"
            status = [string]$PrepackagedSignature.Status
            subject = $PrepackagedSignature.SignerCertificate.Subject
        },
        [ordered]@{
            path = (Split-Path -Leaf $Installer)
            status = [string]$InstallerSignature.Status
            subject = $InstallerSignature.SignerCertificate.Subject
        },
        [ordered]@{
            path = (Split-Path -Leaf $Portable)
            status = [string]$PortableSignature.Status
            subject = $PortableSignature.SignerCertificate.Subject
        }
    )
    $Report = [ordered]@{
        schemaVersion = 1
        kind = "internal-test-signing-report"
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        version = $Version
        result = "pass"
        trust = "self-signed/untrusted/test-only"
        publicReleaseEligible = $false
        certificateRemovedAfterBuild = $true
        metadataRegeneratedAfterSigning = $true
        signatures = $Rows
    }
    $ReportPath = Join-Path $ResolvedOutput "internal-test-signing-report.json"
    [IO.File]::WriteAllText(
        $ReportPath,
        (($Report | ConvertTo-Json -Depth 10) + "`n"),
        [Text.UTF8Encoding]::new($false)
    )
    Write-Host "[test-signing] PASS — test-only signed artifacts: $ResolvedOutput"
}
finally {
    if ($Certificate) {
        Remove-Item "Cert:\CurrentUser\My\$($Certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $StageDir) {
        Remove-Item $StageDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
