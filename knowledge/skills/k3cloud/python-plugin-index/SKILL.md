---
name: python-plugin-index
title: K/3 Cloud Python 插件开发索引
description: 写 K/3 Cloud IronPython 2.7 表单插件(BeforeSave 拦截 / 字段联动 / 按钮点击 / DataChanged)时加载。本 skill 本身是索引,告诉你有哪些子文件可拉,遇到具体问题按需用 load_skill_file 拉详细的事件签名 / API 表 / 模板 / 异常处理姿势。Agent 准备生成 pyBody 传给 kingdee_* 工具前先加载它。
version: 1.0.0
category: plugin-dev
---

# K/3 Cloud Python 插件开发索引

本 skill 覆盖 K/3 Cloud **表单插件**(`FormPlugins` 节点,继承 `AbstractBillPlugIn`)的开发。其他插件类型(操作插件、转换插件、打印插件、报表插件)OpenDeploy v0.1 **不自动化**——如果用户需要这些,查 `k3cloud/bos-features-index` 的 `references/plugin-types` 知道全谱,告知用户手工在 BOS Designer 注册。

## 运行环境速览

- **IronPython 2.7**(2014 年冻结),`.NET Framework` 之上跑
- Python 3 语法**不能用**:没有 `print()` 函数强制、没有 `f"..."`、`dict.items()` 返回 list
- 所有 .NET 类型原生可用:`System.String`, `System.DateTime`, `System.Exception`
- K/3 Cloud 特有类型通过 `clr.AddReference("Kingdee.BOS")` 等引入

## 最小模板

```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn
from Kingdee.BOS.Core.DynamicForm.PlugIn.Args import *
from Kingdee.BOS import KDException

class MyPlugIn(AbstractBillPlugIn):
    # 事件 override 方法写这里
    pass
```

**关键**:`class MyPlugIn` 的类名**不影响注册**——注册在 `FKERNELXML` 的 `<ClassName>` 元素里,是 OpenDeploy 工具的 `pluginName` 参数。脚本里的类名只供可读。

## 子文件导航(按需 load_skill_file)

按你当前要解决的子主题拉对应文件,**不要一次性全拉**——每份 200-400 行,全拉会挤满上下文。

### 过程性指引(prompts/)

| 何时拉 | path 传给 `load_skill_file` |
|---|---|
| 写了 `BeforeSave` 类的校验,不确定 `e.Cancel` 和 `KDException` 怎么配合 | `prompts/error-handling` |
| 注册了插件但没触发,或抛异常 UI 没反应 | `prompts/debugging` |

### 查阅资料(references/)

| 何时拉 | path 传给 `load_skill_file` |
|---|---|
| 要 override 事件,但不知道事件全谱和签名 | `references/events-reference` |
| 写 `self.Model.GetValue(...)` 忘了基础资料字段怎么取 / `self.View` / `self.Context` API 的形状 | `references/model-api` |
| 拿到一个典型场景(保存前校验 / 字段联动 / 按钮触发),想照着模板改 | `references/templates` |

## 使用原则

1. **先把 `solution-decision-framework` 的 3 个澄清问答了再写**——"触发时机"决定你选哪个事件,"异常处理"决定姿势,"数据来源"决定复杂度
2. **不要假定用户装了反编译工具**(`ilspycmd`)——本 skill 的 API 签名是手整理的覆盖 80% 场景,精确签名以用户本地 DLL 为准。签名对不上时告诉用户"以你机器 `D:\K3Cloud\WebSite\Bin\Kingdee.BOS.Core.dll` 为准",不要强求反编译
3. **IronPython 缩进严格**,统一 4 空格,**不要混 Tab**
4. **中文字符串前加 `u` 前缀**:`u"客户必须填写"`,否则某些 .NET 路径会乱码
5. **判空用 `is None`**,不要用 `if not val:`——`0` / `""` / `0.0` 都是 falsy 但不是 None

## 工具触发点

写完 `pyBody` 后的调用链:

```
kingdee_list_extensions         # 查父单据有无现成扩展可复用
  ├─ 有 → kingdee_register_python_plugin(挂到已有扩展)
  └─ 无 → kingdee_create_extension_with_python_plugin(建新扩展 + 挂插件)
```

两条路之后都要**提醒用户**:BOS Designer F5 刷新 / 客户端重登测试。OpenDeploy 不自动刷缓存。
