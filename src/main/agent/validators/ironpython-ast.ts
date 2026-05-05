/**
 * IronPython 2.7 简化 AST 抽取器（regex tokenizer）
 *
 * 用于 K/3 Cloud BOS Calculate 业务规则的 UpdateActions 预飞校验。
 * v0.1 不引入完整 Python AST 解析器，足以覆盖：
 *   - 函数调用（首字母大写或全小写）
 *   - 字段引用（F + 中文/字母数字下划线，可选 .Member）
 *   - GetFieldValue("xxx") 字符串字段引用
 *   - 单行赋值 <Field> = <Expression>
 */

// Suffix uses `*` (not `?`) so chained dotted access like
// `FCustId.FBaseProperty.FName` lands as one token; head extraction below
// only checks the head against schema. K/3 base-data lookups commonly chain
// 3+ levels.
const FIELD_PATTERN = /\bF[\p{Script=Han}A-Za-z0-9_]+(?:\.F?[A-Za-z][A-Za-z0-9_]*)*/gu;
// Lookbehind `(?<![\w.])` excludes attribute method calls like `x.upper()` —
// otherwise `upper` would land in `functions` and SQL_STYLE_FUNCS['UPPER']
// would falsely reject legitimate IronPython string methods.
const FUNCTION_PATTERN = /(?<![\w.])([A-Za-z][A-Za-z0-9_]*)\s*\(/g;
const GET_FIELD_VALUE_PATTERN = /GetFieldValue\(\s*["']([^"']+)["']\s*\)/g;
const ASSIGNMENT_PATTERN = /^\s*(F[\p{Script=Han}A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/u;

export interface ExtractionResult {
  /** 函数名（去重，按首次出现顺序） */
  functions: string[];
  /** 字段引用（含 dotted access，去重，按首次出现顺序） */
  fields: string[];
  /** GetFieldValue("xxx") 中的字符串参数 */
  fieldStringRefs: string[];
}

/**
 * 抽出函数调用 / 字段引用 / GetFieldValue 字符串参数。
 *
 * 注意：FUNCTION_PATTERN 会匹配出形如 `F金额(...)` 这样的"看起来是函数"的字段（如果用户错写）；
 * 但实际 IronPython 对字段当函数调用会运行时报错，规则校验器层不需要拦——只看名字。
 * F 前缀字段名也会被 FIELD_PATTERN 单独抽出，下游可以分别白名单/schema 校验。
 */
export function extractCallsAndFields(source: string): ExtractionResult {
  const functions: string[] = [];
  const fields: string[] = [];
  const fieldStringRefs: string[] = [];
  const seenFunc = new Set<string>();
  const seenField = new Set<string>();
  const seenStrRef = new Set<string>();

  for (const m of source.matchAll(FUNCTION_PATTERN)) {
    const name = m[1];
    // 排除 F-前缀的字段被错当函数（FIELD_PATTERN 会单独抽出）
    if (/^F[\p{Script=Han}]/u.test(name)) continue;
    if (!seenFunc.has(name)) {
      seenFunc.add(name);
      functions.push(name);
    }
  }
  for (const m of source.matchAll(FIELD_PATTERN)) {
    const name = m[0];
    // For dotted access `FCustId.FNumber`, yield both head (FCustId) and full name.
    // Downstream schema check looks at the head; agent may want full path for messaging.
    const dotIdx = name.indexOf('.');
    if (dotIdx > 0) {
      const head = name.slice(0, dotIdx);
      if (!seenField.has(head)) {
        seenField.add(head);
        fields.push(head);
      }
    }
    if (!seenField.has(name)) {
      seenField.add(name);
      fields.push(name);
    }
  }
  for (const m of source.matchAll(GET_FIELD_VALUE_PATTERN)) {
    const arg = m[1];
    if (!seenStrRef.has(arg)) {
      seenStrRef.add(arg);
      fieldStringRefs.push(arg);
    }
  }

  return { functions, fields, fieldStringRefs };
}

export interface ParseAssignmentResult {
  ok: boolean;
  target?: string;
  expression?: string;
  error?: string;
}

/**
 * 解析单行赋值 `<Field> = <Expression>`。
 * Calculate 规则的 UpdateActions 必须是赋值，裸表达式（如 `F数量 * F单价`）会被服务端拒绝。
 */
export function parseAssignment(source: string): ParseAssignmentResult {
  const m = source.match(ASSIGNMENT_PATTERN);
  if (!m) {
    return { ok: false, error: '必须是赋值语句 <Field> = <Expression>，不能是裸表达式' };
  }
  return { ok: true, target: m[1], expression: m[2] };
}
