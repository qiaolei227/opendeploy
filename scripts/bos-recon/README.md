# bos-recon — BOS 侦察工具链 (dev-only)

对 K/3 Cloud BOS Designer 操作做"前后快照 + XE trace"双路侦察,
产出 🟢 实证的 SQL/XML delta 蓝图。

## 前置

- Windows + 已装 SQL Server (K/3 Cloud 连的那个)
- 连接该 SQL Server 的账号有 `ALTER ANY EVENT SESSION` 或 sysadmin 权限
- OpenDeploy 里已建好对应 K/3 Cloud 项目且能连通 (`~/.opendeploy/settings.json` 里有这个项目)
- 目标扩展 FID 已知 (通过 `kingdee_list_extensions` 或 BOS Designer 里看)

## 操作流程

1. 从 `~/.opendeploy/settings.json` 找到目标项目 ID (projects[].id)
2. 跑 before snapshot:
   ```bash
   pnpm recon:snapshot-before -- --project <pid> --ext-id <fid> --label add-text-field
   ```
3. 启 XE session:
   ```bash
   pnpm recon:xe-start -- --project <pid> --label add-text-field
   ```
4. 在 BOS Designer 里做你要侦察的操作 (加字段 / 业务规则 / ...)
5. 操作完,停 XE + 拉 trace:
   ```bash
   pnpm recon:xe-stop -- --project <pid> --label add-text-field
   ```
6. 跑 after snapshot:
   ```bash
   pnpm recon:snapshot-after -- --project <pid> --ext-id <fid> --label add-text-field
   ```
7. 生成 report:
   ```bash
   pnpm recon:diff -- --label add-text-field
   ```
8. `scripts/bos-recon/output/<label>-report.md` 就是侦察产出

## 产出的文件结构

```
scripts/bos-recon/output/
├── <label>-before.json       # snapshot 前 (所有 T_META_* 里匹配 extId 的行)
├── <label>-after.json        # snapshot 后
├── <label>-trace.xel         # SQL Server XE 原始 trace
├── <label>-trace.json        # 解析后的 SQL 事件数组
└── <label>-report.md         # 人类可读的综合 report
```

## 安全 / 合规

- `scripts/bos-recon/output/**` 在 .gitignore 里,不会误提交
- 连接密码从 `~/.opendeploy/settings.json` 读,不在 CLI 参数传明文
- XE target 写文件需要 SQL Server 服务账号对目标目录有写权限 (通常 `C:\ProgramData\...\xe-traces\`)
