# Releasing

A release is a git tag. The workflow in `.github/workflows/release.yml` builds the installer, signs the update package and publishes a GitHub Release. Installed apps read `latest.json` from the latest release and offer the update.

## Publish a version

1. Set the new `version` in `ui/src-tauri/tauri.conf.json`. Also set it in `ui/src-tauri/Cargo.toml` so the two agree.
2. Move the entries of `[Unreleased]` in `CHANGELOG.md` under the new version.
3. Commit, then tag and push:

   ```powershell
   git tag v0.1.1
   git push origin main v0.1.1
   ```

The workflow stops when the tag does not match `version` in `tauri.conf.json`.

The workflow also copies the section of the new version from `CHANGELOG.md` into the notes of the GitHub Release, using `scripts/release-notes.ps1`. The workflow fails when `CHANGELOG.md` has no `## [x.y.z]` heading for the tag. To print the notes yourself: `./scripts/release-notes.ps1 -Version 0.1.2`.

## Signing key

Update packages are signed with a minisign key pair. The app trusts only the public key in `tauri.conf.json` (`plugins.updater.pubkey`).

| Item | Location |
|---|---|
| Private key | `~/.tauri/loq-monitor.key` on the build machine, and the repository secret `TAURI_SIGNING_PRIVATE_KEY` |
| Password | None. GitHub does not store an empty secret, so the workflow reads `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as empty. Set that secret only if you add a password to the key |
| Public key | `ui/src-tauri/tauri.conf.json` and `~/.tauri/loq-monitor.key.pub` |

Keep a copy of the private key somewhere safe. If it is lost, installed apps cannot accept new updates, and every user must install a new build by hand that carries a new public key.

## What the update does

The app checks `https://github.com/cahyata/loq-monitor/releases/latest/download/latest.json` eight seconds after start, unless the user turns it off in SETTINGS. When a newer version exists, a banner offers **INSTALL AND RESTART**. Nothing installs without that click.

The installer runs in passive mode and asks for administrator rights. Before it copies files it stops the sensor service. After it copies files it registers the service again and keeps the sign-in choice made at the first install.

## Limits

- Updates come only from a public repository. A private one needs a token inside the app.
- The installer is not code signed, so SmartScreen can warn on the first install.
