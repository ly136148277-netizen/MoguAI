# MOGU AI Code Signing Policy

```yaml
project: MOGU AI
source: https://github.com/ly136148277-netizen/MoguAI
downloads: https://github.com/ly136148277-netizen/mogu-ai-releases/releases
license: MIT
public_release_status: BLOCKED until trusted Authenticode is Valid
```

## Trust model

MOGU AI uses three separate proofs. They are complementary and must not be
presented as interchangeable:

1. **Windows Authenticode** identifies the Windows publisher and is the only
   proof in this project that can satisfy the `Status = Valid` public-release
   gate.
2. **Sigstore/Cosign** binds release files to the official GitHub Actions
   workflow identity and records transparency evidence. It does not remove
   SmartScreen warnings and is not a replacement for Authenticode.
3. **SHA-256 manifests** detect byte changes after build or distribution but do
   not identify a publisher by themselves.

Self-signed Authenticode certificates are permitted only for internal pipeline
and E2E testing. Their reports must say `self-signed/untrusted/test-only`, and
their artifacts must never be promoted to Public Release.

## Official build origin

Release candidates are built from an exact reviewed Git tag by:

`/.github/workflows/release-supply-chain.yml`

The workflow:

- installs dependencies from `package-lock.json`
- runs unit, acceptance, public-profile and ASAR gates
- creates Payload and Release Evidence manifests
- creates and verifies `SHA256SUMS.txt`
- keyless-signs release files with GitHub OIDC and Sigstore/Cosign
- verifies each Sigstore bundle against the exact workflow identity
- publishes a workflow artifact for review; it does not automatically declare
  a GitHub Public Release

All third-party GitHub Actions are pinned to reviewed commit hashes.

## Public signing policy

A stable Windows release requires one of:

- SignPath Foundation approval and a SignPath origin-verified signing policy
- a trusted OV/EV PFX supplied through protected CI secrets
- Microsoft Azure Artifact Signing with a Public Trust profile

Private keys, PFX files, passwords, access tokens and signing credentials must
never be committed, embedded in an installer, written to evidence manifests or
uploaded as release assets.

After signing, the exact Installer and Portable hashes must pass:

- `Get-AuthenticodeSignature` with `Status = Valid`
- signed installer E2E on a clean profile
- update metadata and blockmap checks
- upload, fresh download, SHA-256 and signature re-verification

## SignPath Foundation attribution

If the application is approved and SignPath is used:

> Free code signing provided by SignPath.io, certificate by SignPath Foundation.

The Windows publisher will be SignPath Foundation under its program terms.

## Reporting

Security and release-integrity issues follow [`../SECURITY.md`](../SECURITY.md).
Release evidence is published beside the corresponding versioned assets.
