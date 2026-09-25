# Contributing to Upriv

Thanks for taking the time. Upriv is a portable encrypted vault manager. You do not need to know the whole architecture to file a useful bug.

**Workflow spec** (branches, commits, PRs, issues, labels): [`docs/gitflow/`](docs/gitflow/README.md).

**Product / build:** [`dev/README.md`](dev/README.md) · [`dev/docs/prd.md`](dev/docs/prd.md) · [`.agent/AGENT.md`](.agent/AGENT.md) (for people and agents working in the tree).

## Ways to help

1. **Bug report** — [open an issue](https://github.com/vinifen/upriv/issues/new?template=1_bug_report.md) with OS, device, desktop vs mobile, and steps. Redact private names if you want.
2. **Suggestion** — [idea template](https://github.com/vinifen/upriv/issues/new?template=2_suggestion.md).
3. **Pull request** — fork (or a branch on this repo), work against **`develop`**, open a PR using the conventions below.

Please write issues, commits, and PR text in **English**. The app UI is translated separately (`dev/docs/LOCALE.md`). Never paste passwords, vault contents, or raw `store/` dumps. Crypto or plaintext-leak reports: [`SECURITY.md`](SECURITY.md).

## Development setup

From `dev/`: Node 22.12+ (`nvm use`), Rust 1.94.0. There **is** a `package.json` at `dev/` (scripts such as `npm run check` / `npm run desktop`) but **no** root `node_modules` — install each app with `--prefix`. Commands: `./run help`, `./run check`. Details in [`dev/README.md`](dev/README.md).

Do not copy patterns from a local `temp/` tree if you have one — that snapshot is not the product contract.

## Git in one screen

```text
main     ← tagged releases only (merge commits)
develop  ← default branch; everyday PRs squash here
```

```bash
git checkout develop
git pull
git checkout -b feat/123/short-slug   # or fix/…, docs/… ; issue number optional
```

Commits (no emoji, no special characters, no AI attribution). Subject = the whole first line, **max 120 characters**:

```text
type(scope): imperative summary

Why this exists, if the subject is not enough.
```

Types: `feat` `fix` `docs` `style` `refactor` `perf` `test` `chore` `infra` `revert` `release` `hotfix`  
Scopes (optional): `core` `rpc` `daemon` `ffi` `desktop` `electron` `mobile` `shared` `docs` `ci`

Open a PR into **`develop`**. Title matches the commit subject. Body: summary, related issue, two-box checklist ([template](.github/pull_request_template.md)). No editor footer (`Made with Cursor`, `Made with [Cursor](https://cursor.com)`, `Co-authored-by`, `Made-with`, `Generated-by`, `Assisted-by`). If one is appended after the PR is created, remove it before the PR is done.

**Author of every commit is the human Git user** (`git config user.name` / `user.email`: local if set, else global). Tools and models are not authors or co-authors. Full rule: [`docs/gitflow/COMMITS.md`](docs/gitflow/COMMITS.md).
