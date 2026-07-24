# SignPath Foundation Application Packet

Status: **PREPARED · owner submission and Foundation approval required**

Official conditions:

- <https://signpath.org/terms.html>
- <https://signpath.org/apply.html>

## Application facts

- Project: **MOGU AI**
- Source repository: <https://github.com/ly136148277-netizen/MoguAI>
- Download page: <https://github.com/ly136148277-netizen/mogu-ai-releases/releases>
- License: **MIT**, root [`LICENSE`](../LICENSE)
- Platform: Windows x64 Electron desktop application
- Build system: GitHub Actions
- Build workflow: `/.github/workflows/release-supply-chain.yml`
- Code signing policy: [`CODE_SIGNING_POLICY.md`](./CODE_SIGNING_POLICY.md)
- Current public artifact: unsigned prerelease only; it is explicitly not
  represented as a signed Public Release

## Eligibility evidence already present

- source and build scripts are publicly reviewable
- releases are downloadable without charge
- the project is actively maintained and already released
- public build excludes user AppData, account credentials, API keys, tokens,
  private paths and private benchmark workspaces
- exact source tags, test reports, payload hashes and distribution evidence are
  retained
- GitHub Actions supply-chain dependencies are pinned to commit hashes

## Required owner/legal confirmation before submission

The owner must confirm each item truthfully; automation cannot decide these:

- every distributed component is under an OSI-approved compatible license
- no proprietary component authored by the maintainer or an affiliate is
  bundled
- third-party notices and license obligations are complete
- product name, icons and other assets may be distributed and signed
- the project accepts SignPath Foundation as the Windows publisher
- the SignPath code of conduct and signing restrictions are accepted

`docs/CAPABILITY_LICENSE_EVIDENCE.md` remains the working record. Any capability
whose license is `UNKNOWN` must stay outside the signed package.

## Suggested application description

> MOGU AI is an MIT-licensed Windows personal AI control center. It provides a
> local Electron trust plane for permissions, secrets, user data and release
> provenance, and connects user-selected AI brains and runtimes. Public builds
> contain no user account data or private credentials. Releases are built from
> reviewed Git tags in GitHub Actions, tested, hashed and accompanied by
> machine-readable evidence.

## After approval

1. Create the SignPath project, artifact configuration and signing policy
   exactly as assigned by SignPath.
2. Enable origin verification for the official repository and reviewed release
   tags.
3. Require approval for release-certificate signing.
4. Add only SignPath-issued identifiers/tokens as protected GitHub secrets.
5. Build the unsigned artifact in GitHub Actions, submit that exact artifact to
   SignPath, then verify `Get-AuthenticodeSignature` reports `Valid`.
6. Run `scripts/test_signed_installer_e2e.ps1 -RequireTrustedSignature`.
7. Perform fresh-download SHA-256, Authenticode, update metadata and client
   update verification before stable publication.

Do not guess SignPath project IDs or commit credentials to this repository.
