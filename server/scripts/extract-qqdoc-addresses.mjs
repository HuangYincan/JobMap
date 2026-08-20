#!/usr/bin/env node
// 官网地址提取 (qqdoc-official drops 缺城市公司的总部城市 + 街道地址)。
//
// 合规铁律 (违反即失败):
// - 只礼貌 GET: 单线程串行、每请求间隔 ≥500ms、UA 注明 domain-map-etl/1.0 (research)。
// - 抓任何页面/主机前先 GET robots.txt (每 host 缓存一次); Disallow 路径不抓;
//   robots 拉取失败 (5xx/网络错) 按「全禁」保守处理; 404 视为无限制。
// - 只抓公司官网域名: official_url 的 host; 跨 host 重定向逐跳重查 robots。
// - official_url 挂在第三方招聘平台 (hotjob.cn / zhiye.com / mokahr.com /
//   51job.com / chinahr.com / wintalent.cn) 的, 不抓该平台, 退回 curated
//   官网候选域名 (title 关键词校验, 不匹配跳过)。
// - 不登录、不碰验证码、不绕过任何反爬; 失败即跳过, 不重试轰炸。
//
// 幂等: 已有真实城市 (市/省/自治区结尾且非公司名) 的公司跳过; 已标
// city_pending 的公司默认跳过 (--retry-pending 可重试)。脚本可重复运行。
//
// 用法: node scripts/extract-qqdoc-addresses.mjs [--dry-run] [--limit N] [--retry-pending]

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  companyNameCity,
  extractCityAndAddress,
} from '../src/lib/recruitment-adapters/official-site-parse.ts';

const QQDOC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'recruitment', 'qqdoc-official');
const UA = 'domain-map-etl/1.0 (research; polite single-threaded ETL; no login, no bypass)';
const MIN_INTERVAL_MS = 500;
const TIMEOUT_MS = 10_000;
const MAX_PAGES_PER_COMPANY = 3;
const MAX_REQUESTS = 350; // 页 + robots 都计入; 超限即停, 剩余标 pending

/** 第三方招聘平台 host 后缀 — 一律不抓 (含 robots)。 */
const ATS_PLATFORM_SUFFIXES = ['hotjob.cn', 'zhiye.com', 'mokahr.com', '51job.com', 'chinahr.com', 'wintalent.cn'];

/** 平台 URL → curated 官网候选 (按序尝试; title 关键词校验, 不匹配跳过)。 */
const INFERRED_OFFICIAL = {
  中国宝武钢铁集团: ['https://www.baowugroup.com/', 'https://www.baowugroup.com.cn/'],
  中国有色矿业集团: ['https://www.cnmc.com.cn/'],
  中国矿产资源集团: ['https://www.cmrg.com.cn/'],
  台州银行: ['https://www.tzcb.com.cn/'],
  广州银行: ['https://www.gzcb.com.cn/'],
  桂林银行: ['https://www.guilinbank.com.cn/'],
  河北银行: ['https://www.hebbank.com/'],
  浙江泰隆商业银行: ['https://www.zjtlcb.com/'],
  浙江稠州商业银行: ['https://www.czcb.com.cn/'],
  深圳农商行: ['https://www.szrcb.com/', 'https://www.rcbk.com.cn/'],
  珠海华润银行: ['https://www.crbank.com.cn/'],
  重庆农村商业银行: ['https://www.cqrcb.com/'],
  中国一汽: ['https://www.faw.com.cn/'],
  中国中化: ['https://www.sinochem.com/'],
};

/** 候选官网 title 必须包含的关键词 (防猜错域名抓到无关站)。 */
const TITLE_KEYWORDS = {
  中国宝武钢铁集团: ['宝武'],
  中国有色矿业集团: ['有色'],
  中国矿产资源集团: ['矿产'],
  台州银行: ['台州'],
  广州银行: ['广州'],
  桂林银行: ['桂林'],
  河北银行: ['河北'],
  浙江泰隆商业银行: ['泰隆'],
  浙江稠州商业银行: ['稠州'],
  深圳农商行: ['农商'],
  珠海华润银行: ['华润'],
  重庆农村商业银行: ['农商'],
  中国一汽: ['一汽', 'FAW'],
  中国中化: ['中化', 'SINOCHEM'],
};

const CONTACT_ANCHOR_RE = /联系(我们|方式)?|关于我们|公司简介|集团概况|联络我们|联系方式/;
const PATH_GUESSES = ['/lxwm/', '/contactus/', '/gywm/'];

// ---------- 请求节流 ----------
let lastRequestAt = 0;
let requestCount = 0;

async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

function countRequest() {
  requestCount += 1;
  if (requestCount > MAX_REQUESTS) {
    throw new Error(`request budget exceeded (${MAX_REQUESTS}) — stop, remaining companies stay city-pending`);
  }
}

// ---------- robots.txt ----------
const robotsCache = new Map(); // host -> { allow: boolean } | { rules: string[] }

/** 按 UA 分组解析 robots.txt: 只采纳 `User-agent: *` 或 `domain-map-etl` 组的
 *  Disallow 规则 (RFC 9309 — 其他爬虫组的规则与我们无关, 不误伤)。 */
function parseRobotsRules(text) {
  const rules = [];
  let inOurGroup = false;
  for (const line of text.split('\n')) {
    const clean = line.replace(/#.*$/, '').trim();
    if (!clean) continue;
    const uaMatch = /^user-agent\s*:\s*(.+)$/i.exec(clean);
    if (uaMatch) {
      const ua = uaMatch[1].trim().toLowerCase();
      inOurGroup = ua === '*' || ua.includes('domain-map-etl');
      continue;
    }
    const disallow = /^disallow\s*:\s*(.*)$/i.exec(clean);
    if (disallow && inOurGroup) {
      const rule = disallow[1].trim();
      if (rule.length > 0) rules.push(rule);
    }
  }
  return rules;
}

async function loadRobots(host) {
  if (robotsCache.has(host)) return robotsCache.get(host);
  const entry = { rules: null, fetchFailed: false };
  try {
    await throttle();
    countRequest();
    const res = await fetch(`https://${host}/robots.txt`, {
      headers: { 'user-agent': UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404 || (res.status >= 400 && res.status < 500)) {
      entry.rules = []; // 无 robots → 无限制
    } else if (res.ok) {
      const text = (await res.text()).slice(0, 64 * 1024);
      entry.rules = parseRobotsRules(text);
    } else {
      entry.fetchFailed = true; // 5xx / 其他: 保守全禁
    }
  } catch {
    entry.fetchFailed = true;
  }
  robotsCache.set(host, entry);
  return entry;
}

function robotsAllowsPath(host, path) {
  const entry = robotsCache.get(host);
  if (!entry) return false;
  if (entry.fetchFailed) return false;
  for (const rule of entry.rules) {
    if (rule === '/') return false; // 全禁
    const pattern = rule
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\/$/, '');
    if (new RegExp(`^${pattern}`).test(path)) return false;
  }
  return true;
}

async function hostAllowsUrl(url) {
  const { host, pathname } = url;
  const entry = await loadRobots(host);
  if (entry.fetchFailed) return false;
  return robotsAllowsPath(host, pathname || '/');
}

// ---------- 页面抓取 ----------
function decodeBody(buf, contentType) {
  const headerCharset = /charset=([\w-]+)/i.exec(contentType ?? '')?.[1]?.toLowerCase();
  const metaCharset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.slice(0, 2048).toString('latin1'))?.[1]?.toLowerCase();
  const charset = headerCharset || metaCharset;
  if (charset && ['gbk', 'gb2312', 'gb18030', 'big5'].includes(charset)) {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      /* fall through */
    }
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // 常见 GBK 页面按 utf-8 解会出现大量替换符 → 回退 gbk。
  const replacements = (utf8.match(/�/g) ?? []).length;
  if (replacements > 20) {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

/** 手动重定向逐跳 (跨 host 重查 robots; ≤5 跳)。返回 { status, finalUrl, buf, contentType } | null */
async function politeGet(rawUrl) {
  let url = rawUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    const u = new URL(url);
    if (!(u.protocol === 'http:' || u.protocol === 'https:')) return null;
    if (!(await hostAllowsUrl(u))) return { status: 403, finalUrl: url, buf: null, contentType: '', robotsBlocked: true };
    await throttle();
    countRequest();
    let res;
    try {
      res = await fetch(u.toString(), {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return null; // 网络错/超时: 跳过, 不重试
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return null;
      url = new URL(location, u).toString();
      continue;
    }
    const contentType = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, 1024 * 1024);
    return { status: res.status, finalUrl: url, buf, contentType, robotsBlocked: false };
  }
  return null;
}

function isHtml(contentType) {
  return /text\/html|application\/xhtml/.test(contentType);
}

/** 同 host 的 联系我们/关于我们 锚点 (取第一个)。 */
function findContactLink(html, baseUrl) {
  const base = new URL(baseUrl);
  const anchorRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]{1,20})<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    const [, href, text] = m;
    if (!CONTACT_ANCHOR_RE.test(text)) continue;
    try {
      const target = new URL(href, base);
      if (target.host === base.host && (target.protocol === 'http:' || target.protocol === 'https:')) {
        return target.toString();
      }
    } catch {
      /* skip bad hrefs */
    }
  }
  return null;
}

// ---------- 主流程 ----------
function needsExtraction(company) {
  const site = company.sites?.[0];
  const city = site?.city?.trim() || '';
  if (!city || city.includes(company.name) || !/市$|省$|自治区/.test(city)) return true;
  return false;
}

function isThirdPartyHost(host) {
  return ATS_PLATFORM_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function safeHost(rawUrl) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return '';
  }
}

function titleMatches(name, html) {
  const keywords = TITLE_KEYWORDS[name] ?? [name];
  const title = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(html)?.[1] ?? '';
  return keywords.some((keyword) => title.includes(keyword));
}

async function crawlCandidates(name, urls, stats) {
  let html = null;
  let finalUrl = null;
  let pageCount = 0;
  let cursor = 0;
  let reason = 'no-address';
  while (pageCount < MAX_PAGES_PER_COMPANY && cursor < urls.length) {
    const url = urls[cursor];
    cursor += 1;
    const page = await politeGet(url);
    if (!page) {
      reason = 'fetch-fail';
      continue;
    }
    if (page.robotsBlocked) {
      reason = 'robots-blocked';
      continue;
    }
    if (!isHtml(page.contentType)) {
      reason = 'not-html';
      continue;
    }
    const text = decodeBody(page.buf, page.contentType);
    html = text;
    finalUrl = page.finalUrl;
    pageCount += 1;
    if (process.env.DEBUG_DUMP_PAGE) {
      await writeFile(process.env.DEBUG_DUMP_PAGE, text, 'utf8');
    }
    const hit = extractCityAndAddress(text);
    if (hit) {
      if (process.env.DEBUG_EXTRACT) {
        const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const at = plain.indexOf(hit.address.slice(0, 12));
        console.error(`[debug] ${name} hit from ${finalUrl}: ${JSON.stringify(hit)}`);
        console.error(`[debug] context: ${JSON.stringify(plain.slice(Math.max(0, at - 60), at + 60))}`);
      }
      return { hit, html, finalUrl, pageCount };
    }
    // 无地址 → 同 host 联系页, 或路径猜测。
    const contact = findContactLink(text, page.finalUrl);
    if (contact) {
      urls.splice(cursor, 0, contact);
      continue;
    }
    const guessed = PATH_GUESSES.find((p) => !urls.some((u) => u.endsWith(p)));
    if (guessed) {
      const u = new URL(page.finalUrl);
      urls.splice(cursor, 0, `https://${u.host}${guessed}`);
      continue;
    }
  }
  void html;
  void finalUrl;
  return { hit: null, html: null, finalUrl: null, pageCount, reason };
}

async function extractCompany(company, stats) {
  const { name, official_url: officialUrl } = company;
  let rawHost = '';
  try {
    rawHost = new URL(officialUrl).host;
  } catch {
    rawHost = '';
  }

  let urls;
  if (isThirdPartyHost(rawHost)) {
    urls = INFERRED_OFFICIAL[name] ?? [];
    if (urls.length === 0) {
      stats.noCandidates += 1;
      return null;
    }
  } else {
    urls = [officialUrl];
  }

  const result = await crawlCandidates(name, urls, stats);
  if (result.hit) {
    const titleOk = isThirdPartyHost(rawHost) ? titleMatches(name, result.html ?? '') : true;
    if (!titleOk) {
      stats.wrongCandidate += 1;
      return null;
    }
    return result.hit;
  }
  stats[result.reason] = (stats[result.reason] ?? 0) + 1;
  return null;
}

function applyExtraction(company, extracted, stats) {
  const site = company.sites[0];
  if (extracted) {
    site.city = extracted.city;
    if (extracted.province) site.province = extracted.province;
    if (extracted.address) {
      site.location = { ...(site.location ?? {}), address: extracted.address };
    }
    stats.extracted += 1;
    return;
  }
  const nameCity = companyNameCity(company.name);
  if (nameCity) {
    site.city = nameCity.city;
    if (nameCity.province) site.province = nameCity.province;
    stats.nameCityFallback += 1;
    return;
  }
  company.city_pending = true;
  stats.pending += 1;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const retryPending = args.includes('--retry-pending');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice(8)) : Infinity;

const files = (await readdir(QQDOC_DIR)).filter((f) => f.endsWith('.json')).sort();
const companies = [];
for (const file of files) {
  try {
    companies.push({ file, company: JSON.parse(await readFile(join(QQDOC_DIR, file), 'utf8')) });
  } catch {
    /* skip unreadable */
  }
}

const stats = {
  total: companies.length,
  skippedAlreadyCity: 0,
  skippedPending: 0,
  extracted: 0,
  nameCityFallback: 0,
  pending: 0,
  noCandidates: 0,
  wrongCandidate: 0,
  requests: () => requestCount,
};

const failures = [];
const outcomes = [];
const touched = [];
let stoppedByBudget = false;

for (const { file, company } of companies) {
  if (!needsExtraction(company)) {
    stats.skippedAlreadyCity += 1;
    continue;
  }
  if (company.city_pending && !retryPending) {
    stats.skippedPending += 1;
    continue;
  }
  if (touched.length >= limit) break;
  try {
    const extracted = await extractCompany(company, stats);
    const site = company.sites[0];
    const cityBefore = site.city;
    applyExtraction(company, extracted, stats);
    if (company.city_pending) {
      failures.push({ name: company.name, reason: 'city-pending' });
    }
    outcomes.push({
      name: company.name,
      status: extracted ? 'extracted' : company.city_pending ? 'city-pending' : 'name-city',
      city: site.city || cityBefore,
      address: site.location?.address ?? null,
      officialHost: safeHost(company.official_url),
    });
    touched.push(file);
  } catch (error) {
    if (String(error.message).includes('budget exceeded')) {
      stoppedByBudget = true;
      if (!company.city_pending) {
        company.city_pending = true;
        touched.push(file);
      }
      break;
    }
    throw error;
  }
}

let wrote = 0;
if (!dryRun && !stoppedByBudget) {
  for (const { file, company } of companies) {
    if (!touched.includes(file)) continue;
    await writeFile(join(QQDOC_DIR, file), `${JSON.stringify(company, null, 2)}\n`, 'utf8');
    wrote += 1;
  }
}

console.log(
  JSON.stringify(
    {
      mode: dryRun ? 'dry-run' : 'apply',
      stats: {
        ...stats,
        requests: requestCount,
        wrote,
        stoppedByBudget,
      },
      failures,
      outcomes,
    },
    null,
    2,
  ),
);
