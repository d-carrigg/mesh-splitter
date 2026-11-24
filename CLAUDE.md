# Mesh Splitter

Run `npm run check` before you push. It is the same command the Checks workflow runs on every PR (about 40 s, no OrcaSlicer or browser). First time: `npm ci`, then `npm ci` in `plugin/`.

The slow checks run only on the Release Please PR: the plugin end-to-end test (`plugin/e2e.mjs`), the real OrcaSlicer test (`plugin/real_orca_test.py`), the site CSP in a browser (`test/csp.browser.mjs`) and the command line binaries.

## Rules and what enforces them

When a rule here is broken again, encode it in a check and change its row. Don't add another sentence.

| Rule | Enforced by |
| --- | --- |
| Every action in a workflow points at a tag or branch that exists | `test/workflows.test.mjs` |
| The real OrcaSlicer test grants every permission the plugin requests | `real_orca_test.requested_permissions()` reads them from `plugin.py`; `test_real_orca_check_can_grant_everything_the_plugin_requests` |
| American English, and never describe the tool as for AI-made models | `test/wording.test.mjs` | <!-- wording-ok: names the banned phrase -->
| The app writes markup only through `setHTML` with an `html` template, which escapes every value | `app/html.js`, `test/html.test.mjs` |
| The site's CSP allows everything the page loads | `test/csp.browser.mjs`: Chromium reports no CSP violation (release PR only) |
| The plugin wheel has no encoded blobs and no huge `.py` (OrcaCloud rates those Medium) | `review_risks` in `plugin/build.py` |
| Send to Orca works after any order of sends, Open as project and deletes | `SendSequenceModel` in `plugin/test_plugin.py` |
| Moving a part shows the gap by default and Fill/Anchor stay closed | `plugin/e2e.mjs` (release PR only) |
| Forks build as "Mesh Splitter (unofficial copy)"; the license ships in the wheel | `BuildTests` |

## Judgment calls nothing checks

- On load, only move the whole model as one rigid piece. Never stretch or reshape parts.
- When Darin gives wording and asks for punctuation or formatting fixes, change only punctuation and formatting.
- A docs-only change doesn't touch `app/` or `plugin/` code. Report an app bug you find instead of fixing it there.
- Don't merge a PR until Darin has seen its result and approved it. Never merge the Release Please PR.
- One PR per ask, one commit per step. Branches are named for the change, like `fix/...` or `feature/...`.
