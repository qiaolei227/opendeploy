下面列出已装载的 skills——每份都是针对特定场景的专家指令。描述匹配当前任务时,先调 `load_skill(id)` 拿完整内容,按返回指令执行。

部分 skill 带子文件:`prompts/*`(过程性指引)、`references/*`(查阅用表格 / API / 模板)。按需调 `load_skill_file(id, path)`,`path` 形如 `"prompts/xxx"` 或 `"references/xxx"`(**不带 `.md` 后缀**)。**只拉当前需要的**——每次调用都有 token 成本。
