# 异常处理姿势

K/3 Cloud 插件的异常阻断有特定的 BOS 惯例。用错姿势会导致"UI 上看起来成功了但数据其实没保存"或者"抛了异常但用户不知道为什么"。

---

## 核心规则:`e.Cancel` 和 `KDException` 要**同时**用

**只在支持 `e.Cancel` 的事件里用**(查 `references/events-reference.md` 的总表)。最常见场景是 `BeforeSave`、`DataChanging`、`BeforeF7Select`。

### ✅ 正确姿势

```python
from Kingdee.BOS import KDException

def BeforeSave(self, e):
    if bad_condition:
        e.Cancel = True
        raise KDException("OPD-SAL-001", u"清晰的中文错误描述")
```

两个都做。缺一个都有坑:

- **只 `e.Cancel = True` 不 raise**:BOS 可能会静默吞掉,用户看到保存按钮没反应但不知道为什么。糟糕的用户体验
- **只 raise 不设 `e.Cancel`**:某些事件 / 某些 BOS 版本,抛异常不等于取消动作。数据可能还是被部分写了

一起用是最稳的。

---

## `KDException` 参数

```python
raise KDException(error_code, message)
```

- **`error_code`**:字符串。**建议格式**:`OPD-<模块>-<序号>-<子序号>`
  - `OPD-SAL-CREDIT-001` — 销售信用类第 1 号
  - `OPD-STK-QTY-003` — 库存数量校验第 3 号
  - 前缀 `OPD-` 区分出自 OpenDeploy 生成的插件,方便后续排障
- **`message`**:中文描述,**前加 `u`**:`u"客户必须填写"`
  - 描述要告诉用户**为什么拦** + **怎么改**,别只说"校验不通过"
  - 差:`u"数据错误"`
  - 好:`u"订单金额 %.2f 超过客户信用额度 %.2f,请先处理已欠款项或联系财务调整额度" % (amt, limit)`

---

## 不同严重程度的选择

### 阻断(最强)

```python
e.Cancel = True
raise KDException("OPD-...", u"...")
```

用户**必须改对**才能继续。用在"真的不能过的规则":金额为负、必填字段缺失、信用额度硬限制。

### 警告但不阻断(中)

```python
self.View.ShowWarnningMessage(u"金额接近信用额度上限,请关注")
# 注意不设 e.Cancel,流程继续
```

用在"值得一提但可以继续":接近阈值、非关键字段缺失。

### 提示(弱)

```python
self.View.ShowMessage(u"已自动填充销售员")
```

用在"告知用户发生了什么":联动填值、状态变化提示。

---

## 常见反模式

### ❌ 把硬异常当正常流程

```python
# 反模式:正常流程里 raise Exception 做"退出当前方法"
def DataChanged(self, e):
    if e.Field.Key != "FCustId":
        raise Exception("not my field")  # ❌ 会被 BOS 报错弹窗
    # ...
```

正常流程用 `return`,不要用异常。

### ❌ 吞异常不抛

```python
def BeforeSave(self, e):
    try:
        check_credit()
    except Exception as ex:
        pass  # ❌ 用户看不到错误,以为保存成功但数据可能半写
```

本 `BeforeSave` 里不要吞。自己的 helper 里可以 try,但要在最外层 raise 出去。

### ❌ 英文错误消息

```python
raise KDException("OPD-001", "credit limit exceeded")  # ❌
```

K/3 Cloud 用户 99% 是中文用户,消息用中文,并加 `u` 前缀避免 IronPython + .NET 编码坑。

### ❌ 把异常消息当日志用

```python
raise KDException("OPD-001",
    u"DEBUG: cust_id=%s, amount=%s, limit=%s" % (...))  # ❌
```

异常消息给用户看,不是给你调试看。调试信息用 `prompts/debugging.md` 里的日志方式。

---

## 从 DLL 反编译的标准用法

如果用户装了 `ilspycmd` 想核对精确姿势,可以反编译:

```
D:\K3Cloud\WebSite\Bin\Kingdee.BOS.dll
  └─ Kingdee.BOS.KDException
```

看自带 BusinessService 是怎么抛异常的,几乎所有 K/3 标准插件都走上面那一对组合。用户没装 ilspycmd 就不要要求,上面的姿势覆盖所有实施场景。
