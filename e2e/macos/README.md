# macOS offscreen runtime

The runner tests real Obsidian with offscreen windows. It requires macOS Apple
silicon, Node.js and Xcode command line tools. `compatibility.json` pins the
loader, application archive, Electron version and original archive hashes.

## Launch and cleanup

The runner verifies compatibility, clones the signed application into an ignored
cache, and patches only that copy. It preserves executable names, disables the
copied loader's updater, injects `bootstrap.cjs`, sets a background application
policy and signs the copy. Cache identity includes the runtime and guard sources.
Cached bundles are checked before reuse.

Each run owns a synthetic `test-vault`, profile, private home, CDP port and process
group. CDP ownership is verified before tests send input. Focus emulation and
input stay inside the renderer. An independent Swift observer starts before
launch, samples visible windows and records activation. A visible or active test
window stops the run. Cleanup stops owned processes and removes private profiles.

`bootstrap.cjs` sets offscreen, invisible, unfocusable, click-through windows
before construction. It blocks showing, activation, window popups and geometry
changes that expose windows. `guards.cjs` cancels native dialogs and menus,
denies permission requests and global shortcut registration, and blocks external
app opening. Guard probes run against the actual application before scenarios.
These restrictions are for test automation, not an OS sandbox.

## Keychain

`--use-mock-keychain` is passed to the actual executable at process creation.
Chromium's macOS key storage chooses its in-memory test keychain from this switch.
Adding it after application startup is too late for native initialization.
The copied executable also has Electron's cookie-encryption fuse disabled in
both Mach-O slices. `asar.mjs` rejects unexpected fuse layouts. The profile and
home are private; tests use synthetic safe-storage values and no copied accounts.
Never approve a test application's request for the user's login Keychain.

## Debugging

- Run `npm run check:compat` for read-only version and hash inspection.
- Check `isolation.json` for observer samples, activation and visibility results.
- Check guard probe results and startup logs in the run's evidence directory.
- An ownership error means the profile or debugging endpoint is not this run's.
  Stop and diagnose it; do not attach tests to another application session.
- A compatibility, signature, fuse or updater-marker error prevents launch.
  Do not bypass it with a normal desktop launch.

`OBSIDIAN_APP` and `OBSIDIAN_APP_ASAR` select application code inputs. Their
versions and hashes must still match the pin. They must not point at a personal
vault or profile. `provision-ci.mjs` prepares pinned public application files only
on a disposable GitHub Actions macOS runner.

## Reviewing an Obsidian update

1. Inspect the new loader, application archive, Electron version and hashes.
2. Review the loader entry point and updater marker, Electron window behavior,
   fuse layout and Chromium mock-keychain handling for that version.
3. Update `compatibility.json` deliberately and run the unit tests.
4. Run the full real-app suite and inspect guard results, screenshots and
   independent isolation evidence. Accept the pin only when those checks pass.

Authenticated login, real permission grants and native OS shortcut success paths
are separate checks because this runtime blocks them.
