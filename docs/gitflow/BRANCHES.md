# Branches

## Permanent

| Branch | Role | Who commits |
|--------|------|-------------|
| **`main`** | Production-ready code and version tags | Release / hotfix merges only |
| **`develop`** | Integration. GitHub **default** branch | Squashed PRs; maintainer may push a trivial one-commit chore |

`develop` may be ahead of `main`. After every release or production hotfix, merge back so `develop` contains `main`.

Do **not** force-push `main` or `develop`.

## Working branches

Created from **`develop`** (except hotfix — see below). Deleted after the PR is merged.

```text
<type>/<short-slug>
<type>/<issue-number>/<short-slug>
```

- **type** — same words as commit types (`feat`, `fix`, `docs`, …).
- **issue-number** — ticket or issue id when the work tracks one. Omit for private chores with no ticket.
- **slug** — lowercase, hyphenated, ≤ ~40 characters. No spaces, no `@`, no AI/product names.

Examples:

```text
feat/vault-root-gate
feat/142/contents-export-zip
fix/login-timeout
fix/210/argon2-header-read
docs/gitflow
chore/eslint-desktop
infra/ci-node-cache
```

Do **not** use `@username/…` prefixes. GitHub already records who opened the PR.

## Release

From **`develop`**, when cutting a version:

```text
release/<semver>
```

Example: `release/0.1.0`, `release/1.0.0-rc.1`

On the branch: version bump, changelog, last fixes. Then:

1. PR → **`main`** (merge commit) and tag `v<semver>`
2. PR or merge → **`develop`** so integration stays current
3. Delete the release branch

## Hotfix

Urgent production patch. **Usually from `main`:**

```text
hotfix/<semver>-<slug>
```

Example: `hotfix/0.1.1-fuse-unmount`

Merge into **`main`** (merge commit, tag) **and** into **`develop`**. If the bug exists only on `develop` (not shipped), use a normal `fix/…` branch from `develop` instead of `hotfix/`.

## Agent rules

- Name branches for the **work**, not for the tool. Never `cursor/…`, `claude/…`, `grok/…`, `copilot/…`.
- Default base: `develop`. Use `main` only for hotfix.
