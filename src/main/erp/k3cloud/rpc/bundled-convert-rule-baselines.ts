/**
 * Vite-side bundle of captured DCXML baselines. Imported only by Electron
 * production paths (via dynamic import in `active.ts`); scripts use
 * `setBundledConvertRuleBaselines()` to inject equivalents read via `fs`.
 *
 * Vite's `?raw` inlines the XMLs as static strings at build time; Node ESM
 * (tsx) rejects unknown extensions, which is why this lives in its own
 * module that scripts never load.
 */

import {
  buildSaleOrderOutStockBaseline,
  type ConvertRuleBaseline,
} from './convert-rule-baselines';
import saleOrderOutstockOriginXml from './baselines/sale-order-outstock-origin.xml?raw';
import saleOrderOutstockExtensionTemplateXml from './baselines/sale-order-outstock-extension-template.xml?raw';

export const bundledConvertRuleBaselines: Record<string, ConvertRuleBaseline> = {
  'SaleOrder-OutStock': buildSaleOrderOutStockBaseline({
    originXml: saleOrderOutstockOriginXml,
    extensionTemplateXml: saleOrderOutstockExtensionTemplateXml,
  }),
};
