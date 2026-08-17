#!/usr/bin/env node
// LLM 并发岗位真实性验证(工作模式数据质量)。
//
//   读取 server/data/recruitment/{radar,official-career} 的全部 drop,对每条
//   公司/岗位调用一次 OpenAI 兼容 chat completions,按确定性 JSON schema 判定:
//     - title 真实性 + 聚合行检测(附拆解建议)
//     - 公司 ↔ 岗位 一致性
//     - 公司 ↔ 站点 ↔ 城市 一致性
//     - applyUrl 域名 ↔ 公司(官网 / 可信 ATS)
//
//   用法:
//     node scripts/validate-positions-llm.mjs [--only a,b] [--sample N]
//       [--limit N] [--concurrency N] [--dry-run]
//
//   env(从 process.env 与 server/.env.local 读取,绝不打印 key):
//     LLM_API_KEY / LLM_BASE_URL(默认 https://api.openai.com/v1)/ LLM_MODEL
//
//   LLM_API_KEY 或 LLM_MODEL 缺失时自动 dry-run:打印条数与示例输入,不调用 LLM,
//   不 crash。并发默认 512(Promise 池),429/5xx/网络错误按指数退避重试 3 次,
//   单条失败记为 error 不中断整体。
//
//   隐私:每次请求只包含单条岗位文本(公司名/行业/站点/标题/部门/技能/applyUrl),
//   不批量泄露其他岗位;LLM 返回只当 JSON 解析,不执行任何内容。
//
//   报告:tech/roles/data/validation-report-<YYYYMMDD>.json(每条 pass/warn/fail/
//   error + 理由 + 聚合拆解建议)+ 控制台汇总。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aggregateTitleHints,
  buildValidationPrompt,
  callChatCompletionsJson,
  domainHint,
  isRetryableStatus,
  parseLlmVerdict,
  verdictLevel,
} from '../src/lib/llm-validate.ts';
import { radarAdapter } from '../src/lib/recruitment-adapters/radar.ts';
import { officialCareerAdapter } from '../src/lib/recruitment-adapters/official-career.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(SERVER_DIR, '..', 'tech', 'roles', 'data');
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const PROGRESS_EVERY = 25;

// --- env(server/.env.local 与 process.env,绝不打印 key)-------------------------
function loadEnvFile() {
  const envFile = path.join(SERVER_DIR, '.env.local');
  if (!fs.existsSync(envFile)) return {};
  const out = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}
const env = { ...loadEnvFile(), ...process.env };
const LLM_API_KEY = env.LLM_API_KEY || '';
const LLM_BASE_URL = env.LLM_BASE_URL || DEFAULT_BASE_URL;
const LLM_MODEL = env.LLM_MODEL || '';

// --- CLI 参数 ------------------------------------------------------------------
function flagValue(name, fallback) {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return fallback;
}
const ONLY = (flagValue('only', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SAMPLE_N = Number(flagValue('sample', 0)) || 0;
const LIMIT_N = Number(flagValue('limit', 0)) || 0;
const CONCURRENCY = Math.min(Math.max(Number(flagValue('concurrency', 512)) || 512, 1), 5000);
const DRY_RUN = process.argv.includes('--dry-run') || !LLM_API_KEY || !LLM_MODEL;

// --- 输入:radar + official-career drops(只读)------------------------------------
async function loadCompanies() {
  const [radar, official] = await Promise.all([radarAdapter().list(), officialCareerAdapter().list()]);
  return {
    radar,
    official,
    total: radar.length + official.length,
    positions: radar.flatMap((c) => c.positions.map((p) => ({ source: 'radar', company: c, position: p }))).concat(
      official.flatMap((c) => c.positions.map((p) => ({ source: 'official-career', company: c, position: p }))),
    ),
  };
}

function buildItems(companies) {
  const items = [];
  for (const { source, company, position } of companies.positions) {
    if (ONLY.length && !ONLY.includes(company.slug)) continue;
    const site = company.sites.find((s) => s.id === position.siteId) ?? company.sites[0];
    items.push({
      source,
      slug: company.slug,
      companyName: company.name,
      industries: company.industries ?? [],
      externalId: position.externalId,
      title: position.title,
      status: position.status,
      department: position.department,
      skills: position.skills ?? [],
      applyUrl: position.applyUrl ?? '',
      siteName: site?.name ?? '',
      address: site?.location?.address ?? '',
    });
  }
  let list = items;
  if (SAMPLE_N > 0 && list.length > SAMPLE_N) {
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    list = shuffled.slice(0, SAMPLE_N);
  }
  if (LIMIT_N > 0) list = list.slice(0, LIMIT_N);
  return list;
}

function promptFor(item) {
  const hints = aggregateTitleHints(item.title);
  const dom = domainHint(item.applyUrl);
  return buildValidationPrompt(
    { name: item.companyName, industries: item.industries },
    { name: item.siteName, location: item.address ? { address: item.address } : {} },
    {
      title: item.title,
      department: item.department,
      skills: item.skills,
      applyUrl: item.applyUrl,
    },
  );
}

async function callWithRetry(item, messages) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const content = await callChatCompletionsJson({
        baseUrl: LLM_BASE_URL,
        apiKey: LLM_API_KEY,
        model: LLM_MODEL,
        messages,
      });
      const verdict = parseLlmVerdict(content);
      if (!verdict) throw new Error('LLM 返回无法解析为 JSON 判定');
      return {
        level: verdictLevel(verdict),
        verdict,
        hints: aggregateTitleHints(item.title),
        domain: domainHint(item.applyUrl),
      };
    } catch (err) {
      lastErr = err;
      if (!isRetryableStatus(err?.status)) throw err;
      if (attempt < MAX_RETRIES - 1) {
        const backoff = RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 400);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastErr;
}

// --- 并发池 ---------------------------------------------------------------------
async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
      done++;
      if (done % PROGRESS_EVERY === 0) {
        process.stderr.write(`validated ${done}/${items.length} (${Math.round((done / items.length) * 100)}%)\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// --- 报告 -----------------------------------------------------------------------
function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function summarize(items) {
  const summary = { total: items.length, pass: 0, warn: 0, fail: 0, error: 0 };
  for (const item of items) summary[item.level]++;
  return summary;
}

function reportJson(companies, items, summary) {
  let baseUrlHost = '';
  try {
    baseUrlHost = new URL(LLM_BASE_URL).host;
  } catch {
    baseUrlHost = LLM_BASE_URL;
  }
  return {
    generatedAt: new Date().toISOString(),
    tool: 'server/scripts/validate-positions-llm.mjs',
    env: {
      model: LLM_MODEL || '(dry-run)',
      baseUrlHost,
      concurrency: CONCURRENCY,
      maxRetries: MAX_RETRIES,
    },
    sources: {
      radar: { companies: companies.radar.length, positions: companies.radar.flatMap((c) => c.positions).length },
      officialCareer: {
        companies: companies.official.length,
        positions: companies.official.flatMap((c) => c.positions).length,
      },
    },
    summary,
    items: items.map((item) => ({
      source: item.source,
      slug: item.slug,
      externalId: item.externalId,
      title: item.title,
      status: item.status,
      level: item.level,
      ...(item.verdict
        ? {
            titleReal: item.verdict.titleReal,
            isAggregateRow: item.verdict.isAggregateRow,
            suggestedSplit: item.verdict.suggestedSplit,
            companyPositionMatch: item.verdict.companyPositionMatch,
            companyCityMatch: item.verdict.companyCityMatch,
            applyDomainMatch: item.verdict.applyDomainMatch,
            reason: item.verdict.reason,
          }
        : { reason: item.error }),
      ...(item.hints?.length ? { aggregateHints: item.hints } : {}),
      ...(item.domain?.domain ? { applyDomain: item.domain.domain } : {}),
    })),
  };
}

// --- main -----------------------------------------------------------------------
async function main() {
  let companies;
  try {
    companies = await loadCompanies();
  } catch (err) {
    process.stderr.write(`读取 drops 失败: ${err.message}\n`);
    process.exit(1);
  }
  const items = buildItems(companies);

  console.log(`LLM 岗位真实性验证 — ${todayStamp()}`);
  console.log(
    `输入: radar ${companies.radar.length} 公司 / ${companies.radar.flatMap((c) => c.positions).length} 岗位` +
      `, official-career ${companies.official.length} 公司 / ${companies.official.flatMap((c) => c.positions).length} 岗位`,
  );
  console.log(`待验证 ${items.length} 条(并发 ${CONCURRENCY},重试 ${MAX_RETRIES} 次,${DRY_RUN ? 'dry-run' : `模型 ${LLM_MODEL}`})`);

  if (DRY_RUN) {
    const missing = [];
    if (!LLM_API_KEY) missing.push('LLM_API_KEY');
    if (!LLM_MODEL) missing.push('LLM_MODEL');
    console.log(`\n== dry-run:未配置 ${missing.join(' / ')},不调用 LLM ==`);
    if (items.length > 0) {
      console.log('示例输入(仅单条岗位文本,不含 key):');
      console.log(promptFor(items[0]).user);
    } else {
      console.log('(无匹配条目)');
    }
    console.log('\n配置 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL 后运行即真实校验;报告写入 ' + REPORT_DIR + '/');
    return;
  }

  const results = await mapPool(items, CONCURRENCY, async (item) => {
    const messages = promptFor(item);
    try {
      const out = await callWithRetry(item, messages);
      return { ...item, ...out };
    } catch (err) {
      const reason = err?.status ? `LLM HTTP ${err.status}` : `LLM 调用失败: ${err?.message ?? err}`;
      return { ...item, level: 'error', error: reason };
    }
  });
  for (let i = 0; i < items.length; i++) items[i] = results[i];

  const summary = summarize(items);
  const reportPath = path.join(REPORT_DIR, `validation-report-${todayStamp()}.json`);
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(reportJson(companies, items, summary), null, 2) + '\n');
  } catch (err) {
    process.stderr.write(`写报告失败: ${err.message}\n`);
    process.exit(1);
  }

  console.log(`\n通过 ${summary.pass} | 警告 ${summary.warn} | 失败 ${summary.fail} | 错误 ${summary.error} | 共 ${summary.total}`);
  const aggregates = items.filter((i) => i.verdict?.isAggregateRow);
  if (aggregates.length) {
    console.log(`\n聚合行建议(${aggregates.length} 条,见报告 suggestedSplit):`);
    for (const a of aggregates.slice(0, 10)) {
      console.log(`  - ${a.slug}「${a.title.slice(0, 40)}」 → ${(a.verdict.suggestedSplit || []).join('、') || '(未给出拆解)'}`);
    }
  }
  console.log(`报告: ${reportPath}`);
}

main().catch((err) => {
  process.stderr.write(`未预期错误: ${err?.stack ?? err}\n`);
  process.exit(1);
});
