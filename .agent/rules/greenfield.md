# Greenfield — the code only knows the current behavior

`dev/` is the first product. Nothing older shipped, so there is no "before" for the code to remember. Every file reads as if it was written today, for the behavior it has today.

## Rules

1. **Describe what is, never what was.** Comments, doc comments, test names, docs, and i18n copy state the current behavior. No "now", "no longer", "instead of", "used to", "previously", "changed to", "new behavior", "was moved", "kept for compatibility".
2. **No legacy paths.** No reader, migrator, fallback, shim, alias, or dual path for an older format, name, layout, setting, or RPC. One way to do each thing. Format rules: [`store-crypto.md`](store-crypto.md) and [`SECURITY-CRYPTO.md`](../SECURITY-CRYPTO.md).
3. **No dead code.** When a change makes something unused, delete it in the same change: functions, types, fields, props, exports, i18n keys, RPC names, allowlist entries, CSS, tests, and docs that only covered it. No commented-out code, no `_unused` renames, no `@deprecated` kept "for now".
4. **Rename, don't wrap.** When a name stops matching what it does, rename it everywhere. Do not keep the old name as an alias or re-export.
5. **Tests pin the current behavior.** A test that only checked removed behavior is deleted or rewritten to the current rule. Test names say what holds, not what changed.
6. **Docs follow in the same change.** When behavior changes, rewrite the sentence in `AGENT.md`, `SECURITY-*.md`, PRD/SDD, and READMEs so it states the current rule. Do not append a note about the change.

Commit messages and PR descriptions are the one place that describes a change; they say what changed and why.

## Do not

- Leave a comment explaining what the code did before.
- Keep an unused parameter, branch, or export because "something might call it".
- Port a pattern from `temp/upriv/` as a second path beside the current one.
- Add a TODO to remove legacy code later — remove it now.
