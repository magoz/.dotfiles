# pi-vimmode loader workaround

## Why this exists

`pi-vimmode` 0.9.0 publishes a minified ESM JavaScript entrypoint. Pi/Jiti loads that file natively, so its imports of Pi SDK packages bypass Pi's host aliases and can resolve another SDK instance from `~/.pi/node_modules`. In this configuration that added roughly 0.8–1.15 seconds to Pi startup.

This extension keeps the npm package installed, while `agent/settings.json` filters out its native extension entrypoint. The loader copies the exact installed bundle, `package.json`, and release-notes asset to a content-addressed `.ts` directory under `~/.cache/pi-vimmode-loader/`. Loading that path through Jiti applies Pi's host aliases. The cache validates file type and content before every import and repairs corruption.

The first transform after installation or a package update may take roughly 0.6–0.9 seconds. Warm startup contribution has measured roughly 20–40 milliseconds.

## Upstream tracking

Monitor these threads:

- pi-vimmode startup benchmark: [pekochan069/pi-vimmode#83](https://github.com/pekochan069/pi-vimmode/issues/83)
- our measurements and prototype report: [issue comment 5146172801](https://github.com/pekochan069/pi-vimmode/issues/83#issuecomment-5146172801)
- Pi duplicate-module-instance issue: [earendil-works/pi#4748](https://github.com/earendil-works/pi/issues/4748)
- closed loader-level attempt and maintainer direction: [earendil-works/pi#7011](https://github.com/earendil-works/pi/pull/7011)

Posting the comment makes the GitHub account a participant in #83, so replies and issue updates should appear in normal GitHub notifications. Do not add a startup network/version check for this workaround.

## When to remove it

Remove the workaround when a released Pi or pi-vimmode version no longer loads a duplicate SDK instance and same-environment measurements show the normal package entrypoint is comparably fast.

Verify before removal:

1. Update Pi and `pi-vimmode` intentionally.
2. Run at least five fresh `PI_TIMING=1` Pi processes with the normal package entrypoint.
3. Confirm `pi-vimmode` import plus registration is consistently near the loader's current 20–40 millisecond warm cost and Vim installs correctly on `session_start`.
4. Confirm changelog display, configuration reload, `/vimmode`, and editor shutdown still work.

Then:

1. Change the filtered object in `agent/settings.json` back to the normal `"npm:pi-vimmode@<version>"` package entry.
2. Delete `agent/extensions/pi-vimmode-loader/`.
3. Refresh `package-lock.json` with `npm --prefix pi/.pi install --package-lock-only --ignore-scripts`.
4. Re-run workspace checks and the full startup benchmark.
5. Delete `~/.cache/pi-vimmode-loader/` after validation.
