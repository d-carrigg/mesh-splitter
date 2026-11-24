# Mesh Splitter

Run `npm run check` before you push. It is the same command the Checks workflow runs on every PR (about 40 s, no OrcaSlicer or browser). First time: `npm ci`, then `npm ci` in `plugin/`.

The slow checks run only on the Release Please PR: the plugin end-to-end test (`plugin/e2e.mjs`), the real OrcaSlicer test (`plugin/real_orca_test.py`), the site CSP in a browser (`test/csp.browser.mjs`) and the command line binaries.

## Release-only checks

| Rule | Enforced by |
| --- | --- |
| The site's CSP allows everything the page loads | `test/csp.browser.mjs`: Chromium reports no CSP violation |
| Moving a part shows the gap by default and Fill/Anchor stay closed | `plugin/e2e.mjs` |

## Judgment calls nothing checks

- On load, only move the whole model as one rigid piece. Never stretch or reshape parts.
- When Darin gives wording and asks for punctuation or formatting fixes, change only punctuation and formatting.
- A docs-only change doesn't touch `app/` or `plugin/` code. Report an app bug you find instead of fixing it there.
- Don't merge a PR until Darin has seen its result and approved it. Never merge the Release Please PR.
- One PR per ask, one commit per step. Branches are named for the change, like `fix/...` or `feature/...`.
