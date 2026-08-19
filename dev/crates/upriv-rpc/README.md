# upriv-rpc

Shared CORE JSON-RPC method handlers used by:

- **`upriv-daemon`** — desktop stdio NDJSON
- **`upriv-ffi`** — mobile UniFFI `invoke(method, params_json)`

Keep method names in sync with `@upriv/shared` `CORE_RPC_COMMANDS` (+ desktop-only `app_shutdown`).

```bash
cd dev
cargo test -p upriv-rpc
```
