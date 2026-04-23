# 知识库贡献指南

> OpenDeploy 的知识库是金蝶 K/3 Cloud 实施智能体的"领域大脑"。**质量大于数量**——一份准确的实证条目比十份照搬手册的占位文好。
>
> 本文档定义了贡献规范、写作纪律、审核流程。

---

## 你能贡献什么

| 类型 | 路径 | 说明 |
|---|---|---|
| 给现有 skill 补内容 | `skills/<ns>/<skill>/references/<topic>.md` | 最常见,补充模块功能 / API / 误判案例 |
| 新建 reference 子主题 | 同上 + 在 SKILL.md body 加导航条目 | 横向扩展能力字典 |
| 新建 prompt 子主题 | `skills/<ns>/<skill>/prompts/<topic>.md` | 决策类("遇到 X 怎么选") |
| 新建完整 skill | `skills/<ns>/<new-skill>/SKILL.md` | 罕见,先开 issue 讨论必要性 |
| 修 bug / 一致性问题 | 任意 | 欢迎 |

**不接受**:
- 直接拷贝金蝶官方手册原文(版权 + 维护性)
- 凭印象 / 凭训练数据生成的"看起来专业但没实证过"的内容
- 营销话术、PPT 风格

---

## 命名空间约定

| 命名空间 | 何时用 |
|---|---|
| `system/*` | OpenDeploy 自身的诊断 / 元工具,**不在 catalog**,只能按名加载 |
| `common/*` | ERP 无关的方法论(实施 plan、排错、文档撰写) |
| `k3cloud/*` | 金蝶云星空特有(BOS / 标准模块 / Python 插件) |
| `<future>/*` | 未来扩展(`sap/`、`oracle/` 等),按相同 ERP 中立架构 |

不要把 K/3 Cloud 知识塞进 `common/*`——会污染未来其他 ERP 的 agent 上下文。

---

## 文件结构

每个 skill 一个目录:

```
<namespace>/<skill-name>/
├── SKILL.md              必需 · YAML frontmatter + body + 子文件导航
├── prompts/              可选 · 过程性指引
│   └── *.md
├── references/           可选 · 查阅资料(API / 字段 / 模板 / 已知坑)
│   └── *.md
└── examples/             可选 · 完整真实示例(plan / 配置 / 代码段)
    └── *.md
```

**SKILL.md body 必须显式列子文件路径**,不要让 agent 从目录名猜。

---

## 内容写作硬规范

### 通用

1. **典型误判段必备**—— "用户通常想要 X,他们会说'需要二开加 Y',但其实 K/3 Cloud 标准是 Z 功能,启用路径 A"
2. **启用路径必须到具体菜单**——不是"系统设置里",而是"系统服务云 → 信用管理 → 启用 → 客户档案 → '信用管理'页签 → `FCreditLimit` 字段"
3. **不照抄官方手册**——你的价值是"实施顾问视角的判断",不是文档复印机
4. **示例必须用真实字段名 / 表名**——`T_BD_CUSTOMER.FCreditLimit` 不是 `customer.creditLimit`
5. **每条新增必须打实证标记**:
   - 🟢 **实证** = 在真实客户环境跑过 / 自己反复试过
   - 🟡 **主流程** = 主干靠谱,具体子场景未实证
   - 🔴 **骨架** = 只起标题占位,内容待补
6. **凭训练数据生成的内容 → 标 🔴 + 临时话术**,**严禁标 🟢**

### 已知坑(known-pitfalls 类)

格式固定:

```markdown
## N. <坑的简称>(YYYY-MM-DD 实证)

### 症状
<可被事实核查的具体描述>

### 根因
<只写已经查清的,推测要标"推测">

### 对策
<具体到工具 / 代码 / 配置层>

### 影响范围
<哪些代码 / 文档要同步改>
```

参考 `skills/k3cloud/bos-features-index/references/known-pitfalls.md`。

### Python 插件模板

模板的价值是**骨架**,不是穷举所有业务。改字段名 + 实体名应该是一行内的事。**新模板贡献门槛**:

- ✅ 展示了一个**新事件**(如 `BeforeF7Select`)
- ✅ 展示了一个**新 API 用法**(如 `ServiceHelper.LoadFromCache`)
- ✅ 展示了一个**容易踩的姿势差异**(如基础资料对象 vs SQL 取扩展字段)

**不接受**:把已有模板"换个业务名字"再提一遍(信用 / 黑名单 / 折扣这些已经够多)。

### 模块功能字典(product-features-index 类)

每条至少包含:

```markdown
### <功能名>
- **需求关键词**: "<顾问 / 客户的常见说法>"
- **标准功能**: <K/3 Cloud 内置功能 + 一句说明>
- **启用路径**: <具体菜单 + 系统参数 + 字段名>
- **典型误判**: <为什么容易被当成二开>
- **OpenDeploy 工具覆盖**: ✅/❌ + 说明
```

参考 `references/sal-sales.md`。

---

## 提交流程

1. **本地写完** → 自查:
   - 实证标记是否真实(没跑过别标 🟢)
   - 启用路径是否到菜单级
   - 字段名 / 表名是否写对
2. **更新对应 SKILL.md 的子文件导航**(如果是新文件)
3. **运行**:
   ```bash
   pnpm knowledge:manifest    # 重算 SHA-256
   pnpm test                  # 跑 skill 解析 / 路径相关单测
   ```
4. **提 PR**:标题 `knowledge(<namespace>/<skill>): <短描述>`,body 写清:
   - 实证背景(在哪个客户环境 / 哪个版本)
   - 影响哪些已有内容
   - 自查清单完成情况

---

## 审核标准

reviewer 会逐条核:

- [ ] 实证标记是否合理(过誉降级)
- [ ] 启用路径菜单级 / 字段名是否写对
- [ ] 有没有跟现有 known-pitfalls / SKILL.md body 冲突
- [ ] 文件大小:reference < 400 行,prompt < 200 行,examples 不限
- [ ] SKILL.md body 子文件导航是否同步更新
- [ ] manifest.json 是否重算

---

## 常见误区

| ❌ | ✅ |
|---|---|
| "K/3 Cloud 销售模块支持 XXX 功能" | "需求关键词 X → 标准功能 Y(启用路径 Z)+ 典型误判" |
| 只写功能名,不写菜单路径 | 路径具体到"系统服务云 → ..." |
| 把所有信用相关示例堆在一起 | 不同模块 / 不同事件用不同示例 |
| "我猜应该是这样" | 没实证就标 🔴 + 临时话术 |
| 一份文件 800 行 | 拆成多个 reference,每个聚焦一个子主题 |

---

## 联系

- GitHub:`qiaolei227/opendeploy-skills`(主仓)
- Gitee 镜像:`QiaOo/opendeploy-skills`
- 问题 / 提案:开 issue 讨论
