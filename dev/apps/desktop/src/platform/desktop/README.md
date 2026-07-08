# Desktop platform adapters

Real `AppServices` implementations that call `upriv-daemon` via `desktopInvokeRaw()` / `rpc*.ts` helpers.

**Status:** stub — `createServices()` still returns `platform/mocks/` until vault RPCs from
`release/0_0_1-beta` are ported to `crates/upriv-daemon/src/rpc.rs`.

## Layout (planned)

```text
platform/desktop/
├── README.md                 # this file
├── createDesktopServices.ts  # factory → AppServices
└── services/                 # one module per @upriv/shared service interface
```

Wire in `platform/services/createServices.ts`:

```typescript
if (isDesktop()) return createDesktopServices();
return mockServices;
```

Keep method names in sync with `lib/commands.ts` and `rpc.rs`.
