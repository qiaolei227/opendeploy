/**
 * Minimal ESLint flat config (ESLint 9). Only enables the rules we need
 * — the project does not yet have full lint coverage, and bulk-introducing
 * style rules now would obscure the actual signal we care about: the BOS
 * XML string-concatenation guard (lever 4 of BOS error-prevention plan,
 * see docs/architecture/bos-write-routes.md).
 */

import tsParser from '@typescript-eslint/parser';

const BOS_XML_TAG_PATTERN =
  '<(XField|XEntity|Form|FormOperation|FormAppearance|EntryEntityAppearance|TabPage|TabPageAppearance|TabControl|TabControlAppearance|BarButtonItem|BarItemLink|BarDataManager|Menu|FormPlugins|FormOperations|EntryEntity|SubEntryEntity|TextField|IntegerField|DateField|DecimalField|PriceField|AmountField|QtyField|CheckBoxField|ComboField|BaseDataField|BasePropertyField|UnitField|ServicePlugins|FormBusinessService|ClickActions|LayoutInfo|LayoutInfos|Appearances|BusinessInfo)\\b';

const BOS_XML_GUARD_MESSAGE =
  'BOS XML string concatenation is forbidden outside the dcxml.ts emitter, ' +
  'frozen overlay files, and the .NET bridge. Pick a route per ' +
  'docs/architecture/bos-write-routes.md §2 (decision tree). New BOS write ' +
  'capabilities go through Route A (bridge) or Route B (envelope rebuild).';

const BOS_XML_RULES = {
  // Catches `'<XField ...>'` / `"<FormOperation>"`.
  'no-restricted-syntax': [
    'error',
    {
      selector: `Literal[value=/${BOS_XML_TAG_PATTERN}/]`,
      message: BOS_XML_GUARD_MESSAGE,
    },
    // Catches  `\`<XField ...>\``  template literals — checks each TemplateElement
    // (the literal segments between ${} interpolations) for BOS XML opening tags.
    {
      selector: `TemplateElement[value.cooked=/${BOS_XML_TAG_PATTERN}/]`,
      message: BOS_XML_GUARD_MESSAGE,
    },
  ],
};

export default [
  {
    // Apply the guard to all source files by default.
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: BOS_XML_RULES,
  },

  {
    // Whitelist: files whose JOB is to emit BOS XML, OR files that legitimately
    // mention BOS tag names in strings (parsers using indexOf, error messages
    // referencing wire shape, agent-tool descriptions documenting BOS concepts).
    //
    // Adding a file here requires sign-off — every addition is a hole in the
    // load-bearing guard for BOS write-route discipline (lever 4 of plan in
    // docs/architecture/bos-write-routes.md).
    files: [
      // ── Route B typed AST → DCXML emitter (canonical XML emission point) ──
      'src/main/erp/k3cloud/rpc/dcxml.ts',

      // ── Route C overlays (frozen in sunset mode, lever 3 deleted orphans) ──
      'src/main/erp/k3cloud/rpc/operation-overlay.ts',
      'src/main/erp/k3cloud/rpc/business-rule-overlay.ts',

      // ── Route B envelope wrapper + ap0 JSON construction ──
      'src/main/erp/k3cloud/rpc/save-for-ide.ts',

      // ── Convert-rule emitters (predate the L1 doc; future refactor pulls
      //    XML emission into dcxml.ts and removes these from the list) ──
      'src/main/erp/k3cloud/rpc/save-convert-rules.ts',
      'src/main/erp/k3cloud/rpc/extend-convert-rule.ts',
      'src/main/erp/k3cloud/rpc/build-patch-base-xml.ts',
      'src/main/erp/k3cloud/rpc/transform-extension-wire.ts',

      // ── Parser layer — uses indexOf('<FormPlugins>') etc. to walk FKERNELXML.
      //    The strings are tag SEARCH literals, not emission. ──
      'src/main/erp/k3cloud/fkernel-parsers.ts',

      // ── Agent tool wrappers — error messages and tool descriptions
      //    legitimately reference BOS XML element names (e.g. "FKERNELXML 中
      //    未找到 <LayoutInfo oid=...>"). Tool wrappers themselves do NOT
      //    construct wire XML; if they ever start to, the construction must
      //    move to a dedicated emitter file and this whitelist entry should
      //    be tightened. ──
      'src/main/agent/bos-rpc-tools.ts',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },

  {
    // Tests legitimately reference BOS XML in fixtures + assertions.
    files: ['tests/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  {
    // Reverse-engineering scripts (capture analysis) construct example XML
    // for diff/templating purposes — not production write paths.
    files: ['scripts/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  {
    // Ignore generated / vendored / build output.
    ignores: [
      'node_modules/**',
      'dist/**',
      'out/**',
      'build/**',
      '.scratch/**',
      'bos-bridge/**',
      'knowledge/**',
    ],
  },
];
