# Development

Run commands from the plugin repository root. Use Node.js 22.13 or newer in the
22 series, or Node.js 24 or later.

```sh
npm ci
npm run build
npm test
npm run format:check
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

Update the version without creating a tag:

```sh
npm version patch --no-git-tag-version
npm run build
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
npm run release:verify -- --tag 0.3.1 --hashes /path/to/validated-build.json
```

Replace `0.3.1` with the manifest version. Obsidian tags have no `v` prefix.
The verifier checks versions, manifest/style hashes, distribution markers,
license notices, and the supplied hash record. It does not run release tests.
Changes to the validated build require rebuilding and revalidation.

Stage only `main.js`, `manifest.json`, and `styles.css` in a fresh directory.
Compare staged files with the saved hashes before uploading. Existing ignored
`release/` directories or ZIPs can contain obsolete builds. `.development/` is
not a release artifact.
