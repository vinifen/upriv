# `.agent/` — AI context for Upriv

| File | Purpose |
|------|---------|
| **[`AGENT.md`](AGENT.md)** | Full project context for coding agents (stack, rules, PRD/SDD map, commands) |
| **[`GIT.md`](GIT.md)** | Commits, branches, PRs, **human-only Git authorship** — read before any git write |
| **[`SECURITY-PLAINTEXT.md`](SECURITY-PLAINTEXT.md)** | **Ship blocker** — no durable plaintext on disk in `encrypted_dir`; what not to port from `temp/` |
| **[`SECURITY-CRYPTO.md`](SECURITY-CRYPTO.md)** | Store crypto + rest layout — Argon2id + HKDF + XChaCha20-Poly1305; `.7z` export only; two storage modes (`encrypted_dir` / `upriv_plain`) |

**Git (full spec, humans):** [`CONTRIBUTING.md`](../CONTRIBUTING.md) · [`docs/gitflow/`](../docs/gitflow/README.md)

**Canonical product specs** (prefer [SECURITY-CRYPTO.md](SECURITY-CRYPTO.md) over PRD/SDD for rest layout, modes, backups, and export):

- [`dev/docs/prd.md`](../dev/docs/prd.md) — Product Requirements Document  
- [`dev/docs/sdd.md`](../dev/docs/sdd.md) — Software Design Document  
