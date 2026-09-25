# Git — agent cheat sheet

Read this **before** any commit, branch, or PR. Human spec: [`docs/gitflow/`](../docs/gitflow/README.md). Cursor reminder: [`.cursor/rules/git-workflow.mdc`](../.cursor/rules/git-workflow.mdc).

Do **not** commit, push, or open a PR unless the human asked.

---

## Author — hard rule

The **only** Git author/committer is the human identity Git would use on this clone.

**Lookup:** `git config user.name` / `git config user.email` (no `--local` / `--global`). That is local if set, otherwise global.

| Do | Do not |
|----|--------|
| `git commit` with **no** `--author` / `--trailer` | Run `git config` unless the human asked to change Git config |
| Use the **effective** identity (local, else global) | Add `Co-authored-by:`, `Made-with:`, `Generated-by:`, `Assisted-by:` for Cursor, Copilot, Claude, ChatGPT, Grok, Composer, or any model |
| Stop if **effective** name or email is empty — ask the human | Invent an identity; name an AI in subject, body, branch, or PR |
| **Verify after every commit** (author/committer + message) | Leave a commit that credits a tool or uses the wrong identity |

Wrong trailer: `Co-authored-by: Cursor <cursoragent@cursor.com>`  
Right: message only. Author and committer are the **effective** `user.name` / `user.email`.

---

## Branches

```text
main      production / tags only
develop   default integration (PR target)
type/slug or type/<issue>/slug   from develop
release/<semver>                 from develop → merge main + develop
hotfix/<semver>-<slug>           from main    → merge main + develop
```

Never `cursor/…`, `claude/…`, `@ai/…`. Never force-push `main` or `develop`.

---

## Commit message

English Conventional Commits, **no emoji** and **no special characters**:

```text
type(scope): imperative summary

Why this exists (1–2 sentences) when the subject is not enough.
```

**Subject** = the whole first line (`type(scope): summary` included). **Maximum 120 characters.** Prefer shorter. Lowercase after the colon, no trailing period. ASCII only — no emoji, no accented/decorative unicode. Punctuation only as the format needs it (`: ( ) - / !`). Extra detail goes in the body (no char cap).

**Types:** `feat` `fix` `docs` `style` `refactor` `perf` `test` `chore` `infra` `revert` `release` `hotfix`  
**Scopes (optional, one):** `core` `rpc` `daemon` `ffi` `desktop` `electron` `mobile` `shared` `docs` `ci`

```text
feat(core): persist vault list from vault-root
fix(desktop): clear gate applying after resolve timeout
docs: add contributing guide and github templates
```

Do not commit secrets, vault material, `.env`, `target/`, `node_modules/`, `dist/`. Commit `Cargo.lock` in the workspace.

### Procedure

1. Confirm **effective** identity: `git config user.name` and `git config user.email`. If either is empty, **stop**.
2. In parallel: `git status`, `git diff`, `git log -5 --oneline` (match this repo’s style).
3. Stage only the intended files.
4. HEREDOC; no `-i`, no `--no-verify`, no `--author`:

```bash
git commit -m "$(cat <<'EOF'
type(scope): summary

Why the change exists.

EOF
)"
```

5. **Always verify** after the commit:

```bash
git config user.name
git config user.email
git log -1 --format='author: %an <%ae>%ncommitter: %cn <%ce>%n%n%B'
```

Author and committer must equal the **effective** name and email. The message must not mention an AI, model, or editor. If the message has AI credit and you just created this unpushed commit: amend only to drop those lines. If identity is wrong: stop and tell the human.

---

## Pull requests

Only when asked. Base **`develop`** (hotfix/release → **`main`**).

| Into | Merge |
|------|--------|
| `develop` | **squash** — PR title becomes the commit subject |
| `main` | **merge commit** — do not squash |

Title: `type(scope): imperative summary` (same as commits; entire title ≤ 120 characters).

Body: fill [`.github/pull_request_template.md`](../.github/pull_request_template.md) — Summary (prefer bullets, what/why), Related issue (`#N/A` unless an issue exists), two checkboxes (secrets + tests).

**No tool footer.** Forbidden in the title and body, even if the host appends it after `gh pr create`:

- `Made with Cursor`
- `Made with [Cursor](https://cursor.com)`
- `Co-authored-by:`
- `Made-with:` / `Generated-by:` / `Assisted-by:`

After `gh pr create` or `gh pr edit`, read the body. If any of those strings is present, `gh pr edit` them out and read the body again before returning the URL.

```bash
gh pr create --title "type(scope): summary" --body "$(cat <<'EOF'
## Summary
-

## Related issue
#N/A

## Checklist
- [ ] No passwords, secrets, or vault material in the diff
- [ ] Tests ran (`./run check` from `dev/`, or note what you ran)
EOF
)"
```

Push `-u` if needed. Then `gh pr view --json body` and strip any `Made with Cursor` / `Made with [Cursor](https://cursor.com)` footer before returning the URL. Do not force-push `main`/`develop`.
