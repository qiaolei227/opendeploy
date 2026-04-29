# bos-bridge

.NET Framework 4.8 console app that wraps Kingdee BOS private serializers
(`Kingdee.BOS.Serialization.DcxmlSerializer` from `Kingdee.BOS.DataEntity.dll`)
so OpenDeploy's main process can read/write BOS metadata in the wire format
the K/3 Cloud server expects.

## Why a separate process

The serializer is .NET-only and tightly coupled to Kingdee's internal
`IDataEntityType` model. There is no clean TS port path. Spawning this as a
sidecar lets us reuse the official serializer without bundling private DLLs.

## Runtime requirement

The user's machine must have K/3 Cloud DeskClient installed
(`C:\Program Files (x86)\Kingdee\K3Cloud\DeskClient\K3CloudClient\`).
We do **not** redistribute Kingdee DLLs — version drift versus the
customer's server would cause subtle metadata bugs.

Override the auto-detected path with `BOS_BRIDGE_DESKCLIENT`.

## Build / run

```pwsh
dotnet build bos-bridge -c Release
dotnet run --project bos-bridge
```

## Status — Phase 1 (DLL load smoke)

Phase 1 just verifies that the project builds against `net48` and that
`DcxmlSerializer` / `ListDcxmlBinder` types load from the local install.

Phase 2 (next): NDJSON request/response loop on stdin/stdout, plus the
first `serialize_convert_rule` op against the captured `req-163` baseline.
