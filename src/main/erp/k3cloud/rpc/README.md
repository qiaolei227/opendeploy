# K/3 Cloud BOS RPC client

Replaces the now-deleted SQL direct-write path (commit `029bacf`) with the
same wire protocol BOS Designer uses to talk to the K/3 Cloud Web Server.

## Architecture

```
                 ┌──────────────────────────────────────────────┐
                 │  agent tool (e.g. k3cloud_create_extension)  │
                 └─────────────────────┬────────────────────────┘
                                       │ SaveExtensionRequest (typed AST)
                                       ▼
                              ┌─────────────────┐
                              │ save-for-ide.ts │
                              └────────┬────────┘
              dcxml.ts (typed AST →    │
              ←────── DCXML string ────┤
                                       │
                              build ap0 = JSON({__source__, __paras__, ...})
                                       │
                              ┌────────▼────────┐
                              │    codec.ts     │ base64 + zlib
                              └────────┬────────┘
                                       │ encoded ap0 string
                              ┌────────▼────────┐
                              │ http-client.ts  │ POST form-encoded
                              └────────┬────────┘
                                       │ kdsvc URL + cookies + clientinfo
                                       ▼
                  http://<host>/k3cloud/...common.kdsvc
                            (BOS server)
```

## Files

- **`types.ts`** — `BosFieldElement`, `BosFieldAppearance`, `SaveExtensionRequest`,
  `SaveExtensionResult`, `BosFieldType` discriminated union (12 variants).
  ElementType numeric codes.
- **`codec.ts`** — `encodeAppLayer` / `decodeAppLayer`. base64 + zlib deflate.
- **`clientinfo.ts`** — emit `BosClientInfo` matching what BOS Designer sends
  (vH/vW/MAC/IP/host/version/OS, dual PascalCase + camelCase keys).
- **`dcxml.ts`** — `buildDcxmlSource(req)`: typed AST → DCXML string. Per-field
  emitters following the schema in memory `bos_dcxml_element_schema.md`.
- **`http-client.ts`** — `callKdsvc(session, serviceName, methodName, opts)`.
  Builds the URL, form, headers (incl. `kdbiz-info` JSON), POSTs, decodes.
  Cookie state on `KdSession`, updated by `applySetCookieToSession`.
- **`login.ts`** — `login(creds)`: GetAuthPublicKey → ValidateLoginInfo.
  RSA password encryption + obfuscation handled in `password.ts`. Production-
  exercised via Plan 5.12.x agent e2e + smoke scripts.
- **`save-for-ide.ts`** — `saveExtension(session, req)`: composes above to
  invoke `MetadataService.SaveForIDEV9`. Returns typed `SaveExtensionResult`.
- **`index.ts`** — public API barrel.

## Status

| Module | Status |
|---|---|
| `types.ts` | ✅ 12 field variants typed |
| `codec.ts` | ✅ working + tested (round-trips real captures) |
| `clientinfo.ts` | ✅ working + tested |
| `dcxml.ts` | ✅ all 12 field types + 12 appearance types + remove + Form root |
| `http-client.ts` | ✅ production-exercised (cookie state survives full save/list cycles) |
| `login.ts` | ✅ frmLogin (local-account) path production-exercised by Plan 5.12.x e2e |
| `password.ts` | ✅ obfuscate / deobfuscate / RSA-PKCS#1-v1.5; round-trip + capture-match tested |
| `save-for-ide.ts` | ✅ production path for register_python_plugins / create_extension / add_fields / operation + button writers |

## Adding a new field type

1. Capture a fresh save in BOS Designer for the new field type
   (`pnpm bos:capture` + interact + `pnpm tsx scripts/bos-recon/decode-capture.ts <log> <reqId>`)
2. Inspect `request-ap0.dec.txt` and the `templates/` cross-save analysis output
3. Add the field type to `BosFieldType` union and `FIELD_ELEMENT_TYPE` table
4. Add a discriminated-union variant in `BosFieldElement`
5. Add a case in `dcxml.ts` `renderFieldElement`'s switch
6. Add appearance specifics in `dcxml.ts` `renderAppearance` if needed
7. Add a snapshot test under `tests/erp/rpc/dcxml.test.ts`

## Reverse-engineering tools

- `scripts/bos-recon/capture-proxy.ts` — HTTP proxy at `:8888` that captures
  BOS Designer ↔ K/3 Cloud Server traffic. Run `pnpm bos:capture`.
- `scripts/bos-recon/decode-capture.ts` — decode one captured request,
  unwrap base64+zlib app layer.
- `scripts/bos-recon/analyze-saves.ts` — diff multiple captures, extract
  per-element-type templates.

## Memory references

- `bos_save_path_is_rpc.md` — overall route discovery (RPC, not SQL)
- `bos_save_for_ide_v9_wire_format.md` — full wire protocol detail
- `bos_dcxml_element_schema.md` — element schema reference table

## Known TODOs (deferred to v0.2+)

1. **`__paras__.FuncInterfaces`** (`save-for-ide.ts`) — currently null;
   production path doesn't need it for the supported scenarios (verified
   across SAL_SaleOrder, BD_Customer, multiple convert-rule flows). May
   need population if a future scenario inherits parent function interfaces
   (e.g. `UpdateCreditAmount`); populate from a parent-load query then.
2. **Cookie jar lifetime** (`http-client.ts`) — currently single-pair
   tracked on KdSession. Production sessions stay alive for hours of agent
   work without issue, but a true multi-day session with re-auth hasn't
   been validated.
3. **clientinfo cache** (`clientinfo.ts`) — currently re-computed every
   call. Cheap, but could be cached on KdSession.
4. **More field types** — current 12 cover common needs but `LongText` /
   `RichText` / `MulCombo` / `Assistant` / `Link` haven't been captured.
