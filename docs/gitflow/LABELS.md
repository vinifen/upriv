# Labels

Keep the set small. One **primary** label from the template; add area or type labels when they help filters.

## Primary (issue templates)

| Label | Color | Meaning |
|-------|-------|---------|
| `bug-report` | `#D73A49` | Something is wrong |
| `suggestion` | `#FFD700` | Idea / enhancement request |
| `task` | `#0052CC` | Scoped development work |

## Type (issues and PRs)

| Label | Color | Meaning |
|-------|-------|---------|
| `fix` | `#D73A49` | Bug fix in progress or landed |
| `hotfix` | `#FF0000` | Production patch |
| `documentation` | `#0075CA` | Docs |
| `test` | `#1D76DB` | Tests |
| `refactoring` | `#FBCA04` | Restructure |
| `infrastructure` | `#FF8C00` | CI / packaging / toolchain |
| `security` | `#B60205` | Crypto, plaintext invariant, auth — **not** for public 0-days |

## Area (monorepo)

| Label | Color | Rough path |
|-------|-------|------------|
| `core` | `#0E8A16` | `dev/crates/upriv-core` |
| `desktop` | `#1D76DB` | `dev/apps/desktop` |
| `electron` | `#5319E7` | `dev/apps/electron` |
| `mobile` | `#E99695` | `dev/apps/mobile` |
| `shared` | `#C5DEF5` | `dev/apps/shared` |

## Public triage

| Label | Color | Meaning |
|-------|-------|---------|
| `good first issue` | `#7057FF` | Small, well-bounded |
| `help wanted` | `#008672` | Maintainer would take a PR |
| `needs-info` | `#D4C5F9` | Waiting on the reporter |

## Create via GitHub CLI

Run from any clone with `gh` authenticated (`vinifen/upriv`):

```bash
gh label create "bug-report" --description "Problem or unexpected behavior" --color "D73A49" --force
gh label create "suggestion" --description "Proposal or idea" --color "FFD700" --force
gh label create "task" --description "Development work item" --color "0052CC" --force

gh label create "fix" --description "Bug fix" --color "D73A49" --force
gh label create "hotfix" --description "Urgent production patch" --color "FF0000" --force
gh label create "documentation" --description "Documentation" --color "0075CA" --force
gh label create "test" --description "Tests" --color "1D76DB" --force
gh label create "refactoring" --description "Restructure without behavior change" --color "FBCA04" --force
gh label create "infrastructure" --description "CI, packaging, toolchain" --color "FF8C00" --force
gh label create "security" --description "Crypto or plaintext-safety work" --color "B60205" --force

gh label create "core" --description "upriv-core" --color "0E8A16" --force
gh label create "desktop" --description "Desktop UI" --color "1D76DB" --force
gh label create "electron" --description "Electron shell" --color "5319E7" --force
gh label create "mobile" --description "Expo / React Native" --color "E99695" --force
gh label create "shared" --description "@upriv/shared" --color "C5DEF5" --force

gh label create "good first issue" --description "Good for a first contribution" --color "7057FF" --force
gh label create "help wanted" --description "Extra attention is welcome" --color "008672" --force
gh label create "needs-info" --description "Waiting on more detail" --color "D4C5F9" --force
```

`--force` updates description/color if the label already exists.
