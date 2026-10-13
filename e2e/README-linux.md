# Linux E2E

With Docker running:

```sh
npm run check -- --modes live,source,reading --shots --record
```

The container builds the plugin, runs automated tests, and runs real Obsidian on
Xvfb with synthetic `test-vault` notes. It is removed after the run. Docker caches
the dependencies and Obsidian download.

Use `--only`, `--modes`, and `--themes` to choose scenarios. Reports, screenshots,
and startup logs are saved in `e2e/evidence/`. `--record` also appends the report
to `test-vault/Validation results.md`. CI runs the same command and uploads evidence.

Change `OBSIDIAN_VERSION` in `e2e/Dockerfile` to update Obsidian. Host credentials
are not mounted. Linux development checks do not replace the release checklist.
