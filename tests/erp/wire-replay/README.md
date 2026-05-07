# Wire-replay regression tests (lever 2 of BOS error-prevention plan)

> See `docs/architecture/bos-write-routes.md` (lever 1) for route definitions.

Each scenario that ships through Route A (bridge) / Route B (envelope rebuild)
/ Route C (overlay) gets a fixture here. CI runs the route on the fixed input
and `toMatchFileSnapshot`s the wire output against the committed snapshot.

**A regression that changes wire output will fail the test in PR**, with a
human-readable diff between the committed snapshot and the new emission.
That's the point — never again ship an envelope-shape change without a
captured intentional snapshot update.

## Layout

```
wire-replay/
├── README.md                          (this file)
├── cases-route-b.ts                   typed inputs for Route B (envelope rebuild)
├── cases-route-c.ts                   typed inputs for Route C (overlay; frozen, no new cases)
├── route-b.test.ts                    test runner for B
├── route-c.test.ts                    test runner for C
└── __snapshots__/
    ├── route-b/<case-name>/source.xml    expected DCXML __source__
    ├── route-b/<case-name>/paras.json    expected __paras__
    └── route-c/<case-name>/overlay.xml   expected overlay fragment
```

> **Route A (bridge) replay** lives separately because it requires the .NET
> sidecar to be built (`dotnet build bos-bridge -c Release`) and the K/3
> Cloud DeskClient install at the standard path. See `tests/erp/wire-replay/
> route-a.test.ts` (skipped in CI; run manually with `BOS_BRIDGE_EXE=...
> pnpm test wire-replay`).

## Adding a case

1. Pick the route (A/B/C) per `docs/architecture/bos-write-routes.md` §2.
2. Add an entry to `cases-route-{b,c}.ts`:
   ```typescript
   {
     name: 'descriptive-kebab-case',
     whyMatters: 'Guards against F4 (fresh extension missing LayoutInfos).
                  Plan 5.12.6 hotfix #4 was about this.',
     input: { /* SaveExtensionRequest or overlay args */ },
   }
   ```
3. Run `pnpm test wire-replay` — first run creates the snapshot files. Inspect them.
4. Commit the case + snapshot together.

## Updating a snapshot intentionally

Wire output is changing on purpose (e.g. fixing a wire bug, adding a new
field type)? Run `pnpm vitest -u wire-replay` to update the snapshot, then
**review the diff in the PR**. Reviewer's job: confirm the new wire is
what the BOS server expects (cross-reference against `.scratch/captures/`
or a fresh capture).

Never blanket-update snapshots without inspection — that defeats the regression catch.

## Why snapshot files instead of inline `expected` strings?

XML/JSON wire is verbose (often 500+ chars per case). Inline `toEqual('...long
string...')` makes case files unreadable. Snapshot files are reviewable as
plain text, and PR diffs show the substantive wire change, not the noise of
TS string-quoting.

## What we explicitly do NOT test here

- HTTP transport (covered by `tests/erp/rpc/codec.test.ts` + `http-client` tests)
- Actual server-side acceptance (requires real K/3 server — manual integration)
- Bridge .NET implementation correctness (covered by bridge unit tests TBD)

This framework catches **TS-side wire emission regressions**. A drift between
"what we send" and "what server expects" still requires a fresh capture to detect.
