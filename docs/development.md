# Development

Use Node.js 22.13 or newer in the 22 series, or Node.js 24 or later.

## Build and install from source

Build the checkout containing the changes you want to use. A fresh clone contains
only changes that have been pushed to GitHub; build your existing checkout to
include local changes:

```sh
git clone https://github.com/junuxyz/Annotate.git
cd Annotate
npm ci
npm run build
```

Copy the generated `main.js`, `manifest.json`, and `styles.css` into
`<vault>/.obsidian/plugins/annotate/`, then enable Annotate in
**Settings → Community plugins**. Keep existing plugin data files when updating.
Source builds require the same macOS Apple silicon and Obsidian 1.14.4 or later
environment as the published release. Local working-tree changes are included
only when you build that checkout.

Run subsequent commands from the plugin repository root:

```sh
npm ci
npm run check:fast
```

`npm run lint:fix` runs ESLint with automatic fixes. Prettier handles formatting
separately. See [architecture](architecture.md) for the source map and
[testing](testing.md) for validation scopes.

## Fast development updates

Install the development build into a development vault:

```sh
npm run dev:install -- "/absolute/path/to/your/vault"
npm run dev
```

Enable or reload Annotate after the first installation. Later successful builds
apply automatically. `npm run dev:vault -- "/absolute/path/to/your/vault"`
combines installation and watching.

`npm run build` produces root distribution files and a separate `.development/`
snapshot. `npm run build:dev` also makes the root files a development build.
Manual Sync and automatic updates read the snapshot, so a distribution build
does not remove development controls through Sync.

The plugin checks the snapshot once per second. Updates wait while a comment is
open, an assistant is responding, or text composition is active, and briefly
after typing. Reload preserves saved data, unsent drafts, and the selected
settings page. A failed revision rolls back and waits for a newer build. The
command **Annotate: Sync latest local development build** allows a manual retry.
Sync replaces only the three build files, not `data.json`.

Validate this mechanism with:

```sh
npm run check -- --dev-build --only smoke,sync,auto-update --record
```

## Releases

Ordinary commits and PRs use `npm run check:fast`, without model calls or Obsidian
E2E. Immediately before creating a version tag, run the full native offscreen
suite on the exact release commit/build:

```sh
npm run check:release
```

Alternatively, dispatch **Pre-tag E2E** on the branch at the exact release commit,
using that same full SHA for the `ref` input. The dispatch SHA must match the source
SHA so the signed provenance identifies the source that was tested. See
[dispatch instructions](testing.md#runtime-and-isolation).
Wait for the entire workflow to succeed and download its `obsidian-e2e-evidence`
artifact. Use the files in `distribution/`, the validated commit and recorded hashes.
Authenticated model checks are separate opt-ins; captured protocol traces and
fixture CLIs cover assistant behavior without paid requests in either default suite.

Update the version without creating a tag:

```sh
npm version patch --no-git-tag-version
npm run check:fast
npm run check:release
npm run release:verify
```

Use `minor` or `major` when appropriate. The version command updates
`package.json`, `package-lock.json`, `manifest.json`, and `versions.json`.
Distribution `main.js` includes the MIT license and third-party notices.

Complete the [release checklist](../test-vault/E2E%20checklist.md) against the
current distribution files before packaging, release installation, or publishing.
Record the validated file hashes and save a machine-readable copy:

```sh
node scripts/release.mjs > /path/to/validated-build.json
```

After validation, compare the files and exact tag against that record:

```sh
npm run release:verify -- --tag 0.4.0 --hashes /path/to/validated-build.json
```

Replace `0.4.0` with the manifest version. Obsidian tags have no `v` prefix.
The verifier checks versions, manifest/style hashes, distribution markers,
license notices, and the supplied hash record. It does not run release tests.
Changes to the validated build require rebuilding and revalidation.

Stage only `main.js`, `manifest.json`, and `styles.css` in a fresh directory.
Compare staged files with the saved hashes before uploading. Existing ignored
`release/` directories or ZIPs can contain obsolete builds. `.development/` is
not a release artifact.

The CI workflow stages these files after full validation and uses the official
[GitHub attestation action](https://github.com/actions/attest) to sign their build
provenance. It needs `contents: read`, `id-token: write` and `attestations: write`.
It saves the signed bundle as `attestation.jsonl` and registers the attestation
with GitHub. This proves build origin and file integrity, not plugin safety.

Before publishing, compare each downloaded file's SHA-256 with
`validated-build.json`, and verify provenance for each file:

```sh
gh attestation verify /path/to/evidence/distribution/main.js \
  --repo junuxyz/Annotate \
  --signer-workflow junuxyz/Annotate/.github/workflows/e2e.yml \
  --source-digest FULL_VALIDATED_COMMIT_SHA
```

Repeat for `manifest.json` and `styles.css`. Set `FULL_VALIDATED_COMMIT_SHA` to
`validated-commit.txt` and confirm it is the exact commit being tagged. The
attestation can also be verified with the saved bundle using `--bundle
/path/to/evidence/attestation.jsonl`. Upload only those three verified files to
the release. Do not run a build between CI validation and upload. A local-only
validation does not generate a GitHub attestation; use the CI workflow when
publishing an attested release.
