# Issues

Issues are the public inbox: bugs, ideas, and (optionally) development tasks.

Templates live in [`.github/ISSUE_TEMPLATE/`](../../.github/ISSUE_TEMPLATE/). Blank issues are allowed; templates are preferred.

## Do not put in an issue

- Passwords, passphrases, or recovery material
- Vault file contents, `contents/` dumps, or decrypted trees
- Full logs that include vault names you consider private — redact
- Crypto or plaintext-leak write-ups that could help an attacker — do not file those as a public issue; see [`SECURITY.md`](../../SECURITY.md)

## Types

| Template | Title prefix | Label | Who uses it |
|----------|--------------|-------|-------------|
| Bug report | `[BUG] …` | `bug-report` | Anyone |
| Suggestion | `[SUGGESTION] …` | `suggestion` | Anyone |
| Development task | `[TASK: TYPE] …` | `task` | Maintainer or a contributor scoping work |

`TYPE` in a task title is a change type: `FEAT`, `FIX`, `DOCS`, `REFACTOR`, …

Examples:

```text
[BUG] Gate stays on applying after vault-root probe fails
[SUGGESTION] Remember last export folder
[TASK: FEAT] Open vault into contents/ on desktop
```

## What a useful bug includes

- What you saw vs what you expected
- Steps to reproduce
- **OS**, **device**, **app** (desktop / mobile), **version or commit**

You do not need a perfect write-up. “Desktop on Fedora, latest main, setup modal loop” is already useful.

## Maintainer notes

- One primary label from the template; add area labels (`desktop`, `core`, …) when obvious.
- Link the PR with `Fixes #N`.
- Issues are **not** required for every private chore. They **are** the right tool for anything a future contributor should see, and for any user-facing defect.

Agents: use `gh` for issues on this repo when asked. Do not file issues the human did not request. Never paste secrets into issue bodies.
