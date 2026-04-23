/**
 * Scrape 金蝶云学堂 (vip.kingdee.com/school) 课程原始数据 — 仅限金蝶云星空 (productLineId=1)。
 *
 * 一次性数据采集脚本，用于人工消化后生成 knowledge/skills 内容。
 *
 * Usage:
 *   pnpm tsx scripts/scrape-kingdee-school.ts                # 公开可见数据
 *   COOKIE="$(<cookie.txt)" pnpm tsx scripts/scrape-kingdee-school.ts  # 带登录 cookie
 *
 * 输出：
 *   scripts/out/kingdee-school-courses.json
 *     {
 *       scrapedAt, productLineId: 1, productLineName: '金蝶AI星空企业版/标准版',
 *       categories: [{ name, fl, count, courses: [...raw items] }]
 *     }
 *
 * 分类 (fl) 列表和 API 参数映射 (fl -> classifyIds) 都是 2026-04-23 在浏览器
 * 里直连 /schoolapi/courses 反推 Nuxt bundle getFilterParams 得到的。如果上游结构变了，
 * 需要重新侦察。
 */
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, 'out', 'kingdee-school-courses.json');
const BASE = 'https://vip.kingdee.com/schoolapi/courses';
const PAGE_SIZE = 20;
const REQ_DELAY_MS = 250;

const CATEGORIES: Array<{ name: string; fl: string }> = [
  { name: '安装部署', fl: '345858115516650496' },
  { name: '性能知识', fl: '16621' },
  { name: '部署运维', fl: '4996' },
  { name: '性能环境', fl: '5705' },
  { name: '财务会计', fl: '4939' },
  { name: '成本管理', fl: '4941' },
  { name: '资产管理', fl: '4940' },
  { name: '管理会计', fl: '4943' },
  { name: '电商与分销', fl: '5695' },
  { name: '零售管理', fl: '5697' },
  { name: '供应链', fl: '4942' },
  { name: 'PLM', fl: '5699' },
  { name: '生产制造', fl: '4948' },
  { name: '质量管理', fl: '4951' },
  { name: '项目制造', fl: '568738664088598272' },
  { name: '智慧车间MES', fl: '17225' },
  { name: '流程中心', fl: '4947' },
  { name: '经营分析', fl: '5701' },
  { name: '基础管理', fl: '4945' },
  { name: '系统管理', fl: '4949' },
  { name: '移动应用', fl: '4950' },
  { name: '管理中心', fl: '4944' },
  { name: '协同开发', fl: '5709' },
  { name: 'BOS平台', fl: '6961' },
  { name: '餐饮', fl: '202502202114014' },
  { name: '共享服务中心（企业版）', fl: '8211' },
  { name: '数据智能服务', fl: '345498832257960448' },
  { name: '税务管理', fl: '202502202114015' },
  { name: '员工服务', fl: '202502202114016' },
  { name: 'IPO中心', fl: '202502202114017' },
  { name: '安全运维（公有云）', fl: '5707' },
  { name: '国际化', fl: '5711' },
  { name: '实施交付', fl: '8014' },
  { name: '前端界面', fl: '231474721207023360' },
  { name: '产品解决方案', fl: '202502202114002' },
  { name: '客户成功', fl: '202502202114003' },
  { name: '营销', fl: '202502202114005' },
  { name: '定制开发管理', fl: '699574973899520256' },
  { name: '数据迁移', fl: '748133108284902912' },
  { name: 'ISV伙伴产品', fl: '703629544913127424' },
  { name: '实操应用', fl: '202502202114008' },
];

interface CoursesResponse {
  code: string;
  count: number;
  last: boolean;
  data: unknown[];
  msg?: string;
  errorCode?: string | null;
  extraMap?: Record<string, unknown>;
}

const cookieHeader = process.env.COOKIE?.trim() || '';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(classifyId: string, pageIndex: number): Promise<CoursesResponse> {
  const qs = new URLSearchParams({
    pageIndex: String(pageIndex),
    pageSize: String(PAGE_SIZE),
    productLineId: '1',
    sortOrder: 'desc',
    classifyIds: classifyId,
  });
  const headers: Record<string, string> = {
    lang: 'zh-CN',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    accept: 'application/json, text/plain, */*',
    referer: 'https://vip.kingdee.com/school/schoolList?cty=course&productLineId=1&lang=zh-CN',
  };
  if (cookieHeader) headers.cookie = cookieHeader;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}?${qs.toString()}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as CoursesResponse;
    } catch (e) {
      lastErr = e;
      await sleep(500 * attempt);
    }
  }
  throw lastErr;
}

async function scrapeCategory(cat: { name: string; fl: string }) {
  const courses: unknown[] = [];
  let pageIndex = 1;
  let declaredCount = 0;
  while (true) {
    const res = await fetchPage(cat.fl, pageIndex);
    if (pageIndex === 1) declaredCount = res.count;
    const batch = Array.isArray(res.data) ? res.data : [];
    courses.push(...batch);
    process.stderr.write(
      `  [${cat.name}] page ${pageIndex} +${batch.length} (total so far ${courses.length}/${declaredCount})${res.last ? ' last' : ''}\n`,
    );
    if (res.last || batch.length === 0) break;
    pageIndex += 1;
    if (pageIndex > 500) {
      process.stderr.write(`  [${cat.name}] aborting at pageIndex ${pageIndex} — sanity cap\n`);
      break;
    }
    await sleep(REQ_DELAY_MS);
  }
  return { name: cat.name, fl: cat.fl, count: declaredCount, scraped: courses.length, courses };
}

async function main() {
  process.stderr.write(`cookie: ${cookieHeader ? 'provided' : 'none (public data only)'}\n`);
  process.stderr.write(`categories: ${CATEGORIES.length}\n\n`);

  await fs.mkdir(dirname(OUT_PATH), { recursive: true });

  const results: Array<Awaited<ReturnType<typeof scrapeCategory>>> = [];
  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i];
    process.stderr.write(`[${i + 1}/${CATEGORIES.length}] ${cat.name} (fl=${cat.fl})\n`);
    try {
      const r = await scrapeCategory(cat);
      results.push(r);
    } catch (e) {
      process.stderr.write(`  FAILED: ${String(e)}\n`);
      results.push({ name: cat.name, fl: cat.fl, count: -1, scraped: 0, courses: [], error: String(e) } as never);
    }
    await sleep(REQ_DELAY_MS);
  }

  const totalScraped = results.reduce((s, r) => s + r.scraped, 0);
  const totalDeclared = results.reduce((s, r) => s + Math.max(0, r.count), 0);

  const payload = {
    scrapedAt: new Date().toISOString(),
    source: BASE,
    productLineId: 1,
    productLineName: '金蝶AI星空企业版/标准版',
    authenticated: Boolean(cookieHeader),
    totalDeclared,
    totalScraped,
    categoryCount: CATEGORIES.length,
    categories: results,
  };

  await fs.writeFile(OUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  process.stderr.write(`\n✓ wrote ${OUT_PATH}\n`);
  process.stderr.write(`  total scraped: ${totalScraped} (declared: ${totalDeclared})\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
