/**
 * K/3 Cloud BOS Calculate (ActionId=2) 业务规则的预飞校验。
 *
 * 用法：在 agent 工具 (k3cloud_add_calculate_rule, Task 3.5) 把 LLM 生成的
 * UpdateActions 推到 K/3 之前调一次。如果 ok=false，把 errors[] 回给 LLM
 * 让其修正（route C: validate-and-retry，参见 memory plan_5_12_decisions）。
 *
 * 校验项：
 *   1. 必须是赋值语句 (parseAssignment)
 *   2. 不能含 Python 3 语法 (print() / f-string / async)
 *   3. 函数名要么在 FUNC_DEFINE_WHITELIST、要么是 PYTHON_BUILTINS、要么禁止
 *      （SQL 风格函数会带 Python 改写提示）
 *   4. 引用字段必须存在于父对象 schema（包含 target / 直接引用 / GetFieldValue 字符串参数）
 *
 * 数据来源：
 *   - FUNC_DEFINE_WHITELIST = K3 BillFunctions (recon §2.1, 2026-05-04-business-rules-tier-b.md)
 *   - PYTHON_BUILTINS = IronPython 2.7 内置（保守子集）
 *   - SQL_STYLE_FUNCS = LLM 常见的 SQL 风格幻觉 + Python 等价改写
 */

import { extractCallsAndFields, parseAssignment } from './ironpython-ast';

/**
 * 父对象字段 schema。Task 3.3 (field-existence.ts) 的产物，
 * 但本文件直接 inline 接口定义，0-dep 于 Task 3.3。
 */
export interface FieldSchema {
  fields: string[];
}

const FUNC_DEFINE_WHITELIST = new Set([
  'GetFlexDetailValue', 'GetPKValue', 'GetAcronym', 'BillTypeParam',
  'IsFloatUnitConvert', 'OperationStatus', 'SysParam',
  'Avg', 'Count', 'IsDraw', 'IsPush',
  'GetCurrOrg', 'GetUser', 'GetFieldValue', 'GetDate', 'GetTime',
]);

const PYTHON_BUILTINS = new Set([
  'len', 'str', 'int', 'float', 'bool', 'round', 'abs', 'max', 'min',
  'sum', 'sorted', 'isinstance', 'type', 'range', 'list', 'dict', 'set',
  'map', 'filter', 'reduce', 'tuple', 'frozenset',
]);

const SQL_STYLE_FUNCS: Record<string, string> = {
  IIF: '用 Python 三目: 值A if 条件 else 值B',
  CONCAT: '用 + 拼接字符串',
  DATEADD: '用 .NET: F日期.AddDays(N)',
  ISNULL: '用 Python: x if x is not None else 默认值',
  DATEDIFF: '用 .NET: (F日期1 - F日期2).Days',
  LEN: '用 Python 全小写 len(x)',
  ROUND: '用 Python 全小写 round(x, n)',
  SUBSTR: '用 Python 切片 x[a:b]',
  UPPER: '用 Python: x.upper()',
  LOWER: '用 Python: x.lower()',
};

const PYTHON_3_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /\bprint\s*\(/, message: 'print() 是 Python 3 语法。IronPython 2.7 用 print 语句不带括号' },
  { pattern: /\bf["']/, message: 'f-string 是 Python 3.6+ 语法。IronPython 2.7 不支持，用 .format() 或 % 拼接' },
  { pattern: /\basync\s+def\b/, message: 'async/await 是 Python 3.5+ 语法。IronPython 2.7 不支持' },
];

const FUNC_TYPO_HINTS: Record<string, string[]> = {
  GetCurrentTime: ['GetTime', 'GetDate'],
  Now: ['GetDate', 'GetTime'],
  Today: ['GetDate'],
  CurrentUser: ['GetUser'],
};

export interface CalcValidationError {
  /** 1-based action 行号 */
  line: number;
  /** 涉及的字段名（schema check failure） */
  field?: string;
  /** 候选 nearest match（levenshtein） */
  suggestions?: string[];
  /** 用户可读的报错原因（中文） */
  message: string;
}

export interface CalcValidationResult {
  ok: boolean;
  errors?: CalcValidationError[];
}

export function validateCalculateRule(
  actions: string[],
  schema: FieldSchema,
): CalcValidationResult {
  const errors: CalcValidationError[] = [];
  const knownFields = new Set(schema.fields);

  actions.forEach((action, i) => {
    const line = i + 1;
    const stripped = action.trim();

    // 1. Parse assignment structure
    const parsed = parseAssignment(stripped);
    if (!parsed.ok) {
      errors.push({ line, message: parsed.error! });
      return;
    }

    // 2. Check Python 3 patterns
    for (const { pattern, message } of PYTHON_3_PATTERNS) {
      if (pattern.test(stripped)) {
        errors.push({ line, message });
      }
    }

    // 3. Extract functions and fields
    const { functions, fields, fieldStringRefs } = extractCallsAndFields(stripped);

    // 4. Function whitelist check
    for (const fn of functions) {
      if (FUNC_DEFINE_WHITELIST.has(fn)) continue;
      if (PYTHON_BUILTINS.has(fn)) continue;
      const sqlHint = SQL_STYLE_FUNCS[fn.toUpperCase()];
      if (sqlHint) {
        errors.push({
          line,
          message: `${fn} 是 SQL 风格函数，IronPython 不支持。${sqlHint}`,
        });
        continue;
      }
      const suggestions = FUNC_TYPO_HINTS[fn] ?? nearestFuncs(fn);
      errors.push({
        line,
        message: `函数 ${fn} 不在白名单。可选: ${suggestions.join(' / ')}`,
      });
    }

    // 5. Field existence (target + referenced fields' head + GetFieldValue arg fields)
    const allReferenced = new Set<string>();
    if (parsed.target) allReferenced.add(parsed.target);
    for (const f of fields) {
      const head = f.split('.')[0];
      allReferenced.add(head);
    }
    for (const f of fieldStringRefs) allReferenced.add(f);

    for (const f of allReferenced) {
      if (!knownFields.has(f)) {
        errors.push({
          line,
          field: f,
          suggestions: nearestStrings(f, schema.fields),
          message: `字段 ${f} 不在父对象 schema 里`,
        });
      }
    }
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

function nearestFuncs(target: string): string[] {
  const all = [...FUNC_DEFINE_WHITELIST, ...PYTHON_BUILTINS];
  return nearestStrings(target, all).slice(0, 3);
}

function nearestStrings(target: string, candidates: string[]): string[] {
  return candidates
    .map((c) => ({ c, d: levenshtein(target, c) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((s) => s.c);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}
