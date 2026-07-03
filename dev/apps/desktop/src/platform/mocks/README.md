# Prototype mocks (temporary)

Desktop adapters (`platform/desktop/` + `upriv-daemon` + `upriv-core`) replace mocks in
`createServices()`. That includes `data/`, `stores/`, and `services/` under this folder.

When wiring desktop RPC, drop the folder and/or rename to neutral names (`createServices` exports,
service interfaces in `@upriv/shared`).

Delete this folder when desktop services replace mocks in `createServices()`.
