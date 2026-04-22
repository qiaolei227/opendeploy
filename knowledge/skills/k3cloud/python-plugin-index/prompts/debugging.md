# 插件排障流程

插件已注册但行为不符合预期时走这个流程。顺序很重要:从"是否触发"查起,不要跳过中间步骤。

---

## 症状 → 第一步查什么

| 症状 | 先查 |
|---|---|
| 按钮 / 保存完全没反应,像没装过插件 | §1 是否成功注册 |
| 插件代码里加了 print / ShowMessage,完全没执行 | §2 事件是否触发 |
| 事件触发了但抛"AttributeError" / "ImportError" | §3 IronPython 语法错误 |
| `GetValue` 返回 None / 不对 | §4 字段 Key 写错 |
| `e.Cancel = True` 设了但用户还是能保存 | §5 异常 / Cancel 姿势不对 |
| 改了代码没生效 | §6 缓存没刷新 |

---

## §1 是否成功注册

```
调 kingdee_list_form_plugins(baseObjectId='<父单据>')
  └─ 看有没有你注册的 ClassName
```

没有 → 注册压根没成功,重试 `kingdee_register_python_plugin` 或 `kingdee_create_extension_with_python_plugin`,看工具返回的错误消息。

有 → §2。

---

## §2 事件是否触发

临时在事件最开头塞一行 `ShowMessage`:

```python
def BeforeSave(self, e):
    self.View.ShowMessage(u"DEBUG: BeforeSave 触发了")
    # ...
```

重新注册 → 客户端 **重登**(F5 不一定够)→ 复现操作。

- 没弹出 DEBUG 消息 → 事件名拼错了 / 事件在这个单据类型上不触发 / 插件注册到错的父单据
- 弹出了 → 事件 OK,问题在下面的逻辑。删 DEBUG 那行 § 3 继续

**常见事件名错误**:
- ❌ `beforeSave`(应是 `BeforeSave`,首字母大写)
- ❌ `BeforeSaved`(多了个 d)
- ❌ `OnBeforeSave`(不要加 On 前缀)

---

## §3 IronPython 语法错误

K/3 Cloud 客户端没有插件调试器,IronPython 错误通常表现为**静默不执行**或**弹出一个没什么上下文的 CLR 异常框**。

**排查**:在 `AfterBindData` 里塞一行确认插件**本身能加载**:

```python
def AfterBindData(self, e):
    self.View.ShowMessage(u"PLUGIN LOADED")
```

如果这个消息都不弹,说明 py 文件解析就失败了。常见原因:

1. **混用 Tab 和空格**——IronPython 严格,必须统一 4 空格
2. **Python 3 语法**——
   - `print("x")` 不行,IronPython 2.7 要 `print "x"`(或加 `from __future__ import print_function`)
   - `f"..."` 不行,用 `"%s" % val`
3. **中文字符串没 `u`**——`"客户"` 可能乱码,要 `u"客户"`
4. **缩进不对齐**——哪怕只差 1 空格也错

**修复**:改代码 → `kingdee_unregister_plugin` 再 `kingdee_register_python_plugin`(或调 `kingdee_create_extension_with_python_plugin` 覆盖)→ §6 刷缓存 → 重测。

---

## §4 字段 Key 写错

`GetValue` 返回 None 但你确定字段有值 = Key 错了。

**查 Key**:调 `kingdee_search_metadata(database='<db>', keyword='<你想的字段中文名>')`,返回里找 `FKEY`。

- 头字段 vs 明细字段:明细字段要 `GetValue("FQty", row_index)` 不是 `GetValue("FQty")`
- 子单据体字段:要三参数 `GetValue("FTaxRate", row, "FTaxDetailSubEntity")`
- 扩展字段:如果用户加了扩展字段,Key 可能是 `F_PAIJ_CreditLimit` 这种带开发商前缀的,不是纯 `FCreditLimit`

---

## §5 异常 / Cancel 姿势不对

设了 `e.Cancel = True` 但用户依然能保存 → 几乎肯定是姿势不对:

```python
# ❌ 只设 Cancel
def BeforeSave(self, e):
    if bad:
        e.Cancel = True
        return  # 某些 BOS 版本不够

# ✅ 两个一起
def BeforeSave(self, e):
    if bad:
        e.Cancel = True
        raise KDException("OPD-001", u"清晰描述")
```

详见 `prompts/error-handling.md`。

---

## §6 缓存没刷新

改了 py 代码但行为没变 → 大概率缓存:

1. **BOS Designer 缓存**:在 Designer 里打开扩展对象列表,**F5 刷新**
2. **客户端表单缓存**:用户已经打开的单据要**重登客户端**,F5 可能不够
3. **服务端插件缓存**:某些情况需要重启 IIS 应用池(生产环境慎用,告知用户自行决定)

OpenDeploy 工具**不自动刷缓存**。每次注册成功后主动提醒用户:
> "注册成功,backup 已写入 `<path>`。请在 BOS Designer F5 刷新看到扩展,并**重新登录 K/3 Cloud 客户端**以加载新插件。"

---

## 仍然搞不定的升级路径

走完 §1-§6 还不行,按难度升级:

1. 查 K/3 Cloud 客户端日志(`%ProgramData%\Kingdee\K3Cloud\logs`,具体路径以客户环境为准)
2. 如果用户装了 `ilspycmd`:反编译 `Kingdee.BOS.Core.Bill.PlugIn.AbstractBillPlugIn` 看父类实现,核对事件签名
3. **告诉用户**:当前判断不出,建议他们在金蝶生态社区发帖(erp100.com / 金蝶云官方论坛)或者找熟手二开排查。agent 诚实承认极限,不硬造"可能是 X 造成的"乱猜
