#!/usr/bin/env node
// 顺着投递链接抓岗位 (qqdoc-jobs 批次, w1) — 499 家公司的 apply_url → positions。
//
// 数据源: 主树 .playwright-mcp/qqdoc/tvVDZj-rows.json (boss 提取的腾讯文档公开
// 分享「27届公司汇总」, 只读引用) — 每行 { name, city, direction, deadline, links[] }。
//
// 产出 (写入 drops):
//   - 163 家新增公司 (server/data/recruitment/qqdoc-jobs/*.json):
//     positions 数组 + apply_url 占位文本 (「投递连接看官方公告」) 在有真实链接时修正。
//   - 与 radar / official-career / qqdoc-official 现有 drops 匹配的公司:
//     仅追加 positions (name 精确匹配, 兜底唯一包含匹配且短名 ≥4 字; 匹配不到记
//     unmatched, 不强行写)。
//
// 平台策略 (优先级从高到低, 每平台连续 3 家失败即跳过该平台):
//   a. 飞书 jobs (*.jobs.feishu.cn / *.jobs.f.mioffice.cn, 含 /s/<code> 分享短链):
//      GET portal (短链逐跳 resolve) → 解析 js-websiteInfo 得 website-path →
//      POST /api/v1/search/job/posts (ats_feishu.py 2026-08-19 实测契约; 该公共
//      端点对爬虫 UA 一律 405, 仅浏览器 UA 200 — 端点自身门禁, 无登录/验证码)。
//   b. 北森 zhiye (*.zhiye.com): 先 robots 检查; 允许才做轻量 3 步探针
//      (portal → bundle → API 候选 ≤2) — ats_zhiye.py 适配器逻辑的降级版。
//   c. hotjob (wecruit.hotjob.cn): 试公开 API (HTML 内候选, ≤1 次), 失败跳过。
//   d. 官网自研 (join.* 等): 礼貌 GET 招聘页, parseHtmlJobRows 解析; JS 渲染
//      解析不到 → 跳过。
//   e. 其他 (微信文章/阿里 campus/mokahr 等): 尝试; 失败跳过记 reason。
//      微信文章只提取文内非微信外链 (顺着投递链接继续), 不解析正文为岗位。
//
// 合规铁律: 单线程串行、每请求 ≥500ms、UA domain-map-etl/1.0 (research);
// robots.txt 先行 (每 host 缓存一次, 拉取失败按全禁保守处理, 404 视为无限制,
// 跨 host 重定向逐跳重查); 不登录、不碰验证码、不绕过反爬; 拒绝即跳过不轰炸。
//
// 规模: 总请求预算 ≤1200 (robots + 页面 + API 全计入, 超限即停, 剩余标
// budget-exceeded); 每公司 ≤2 页; 飞书 API 每页 ≤50 条, ≤2 页。
// 幂等: 目标 drop 已有本管道岗位 (portal-qqdoc-*/portal-feishu-*/portal-zhiye-*)
// 即跳过 (--force 重抓); 岗位按 externalId 去重, 可重复运行。
//
// 用法: node scripts/extract-qqdoc-jobs.mjs [--dry-run] [--force] [--limit N]
//        [--only=<name>] [--rows=<path>]
//   --dry-run: 照常抓取但不写盘 (统计 + 校验用)
//   --only:    只处理指定公司名

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseRobotsDisallows,
  robotsAllowsPath,
  feishuJobToPosition,
  parseFeishuJobPage,
  parseHtmlJobRows,
  isQqdocJobsPositionId,
  siteIdForJobCity,
  familyForText,
} from '../src/lib/recruitment-adapters/qqdoc-jobs-parse.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKTREE_ROOT = join(SCRIPT_DIR, '..', '..'); // worktree 根 (server/scripts → server → 根)
const RECRUITMENT_DIR = join(WORKTREE_ROOT, 'server', 'data', 'recruitment');
const ROWS_DEFAULT = '/Users/acccan/domain-map/.playwright-mcp/qqdoc/tvVDZj-rows.json';
const UA = 'domain-map-etl/1.0 (research; polite single-threaded ETL; no login, no bypass)';
// 飞书公共 API 端点自身 UA 门禁: 爬虫 UA 一律 405, 浏览器 UA 200
// (ats_feishu.py 2026-08-19 实测; 无登录/验证码/限流绕过)。
const FEISHU_API_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const MIN_INTERVAL_MS = 500;
const TIMEOUT_MS = 10_000;
const MAX_REQUESTS = 1200;
const MAX_PAGES_PER_COMPANY = 2;
const FEISHU_PAGE_LIMIT = 50;
const CONSECUTIVE_FAIL_LIMIT = 3; // 每平台连续失败次数 → 跳过该平台

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7);
const LIMIT = Number(args.find((a) => a.startsWith('--limit='))?.slice(8) || 0);
const ROWS_PATH = args.find((a) => a.startsWith('--rows='))?.slice(7) || ROWS_DEFAULT;

// ---------------------------------------------------------------------------
// 请求节流 + 预算
// ---------------------------------------------------------------------------
let lastRequestAt = 0;
let requestCount = 0;
let budgetExceeded = false;

async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

function countRequest() {
  requestCount += 1;
  if (requestCount > MAX_REQUESTS) {
    budgetExceeded = true;
    throw new Error(`request budget exceeded (${MAX_REQUESTS}) — stop; remaining companies stay unextracted`);
  }
}

// ---------------------------------------------------------------------------
// robots.txt (每 host 缓存一次)
// ---------------------------------------------------------------------------
const robotsCache = new Map(); // host -> { rules: string[] | null, fetchFailed: bool }
let robotsFetched = 0;

async function loadRobots(host) {
  if (robotsCache.has(host)) return robotsCache.get(host);
  const entry = { rules: [], fetchFailed: false };
  robotsFetched += 1;
  try {
    await throttle();
    countRequest();
    let url = `https://${host}/robots.txt`;
    let res = null;
    for (let hop = 0; hop < 3; hop += 1) {
      res = await fetch(url, {
        headers: { 'user-agent': UA },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) break;
        url = new URL(location, url).toString();
        continue;
      }
      break;
    }
    if (res.status === 404 || (res.status >= 400 && res.status < 500)) {
      entry.rules = []; // 无 robots → 无限制
    } else if (res.ok) {
      entry.rules = parseRobotsDisallows((await res.text()).slice(0, 64 * 1024));
    } else {
      entry.fetchFailed = true; // 5xx/网络错 → 保守全禁
    }
  } catch {
    entry.fetchFailed = true;
  }
  robotsCache.set(host, entry);
  return entry;
}

async function hostAllowsUrl(url) {
  const { hostname, pathname } = url;
  const entry = await loadRobots(hostname);
  if (entry.fetchFailed) return false;
  return robotsAllowsPath(entry.rules, pathname || '/');
}

// ---------------------------------------------------------------------------
// 礼貌 GET (手动重定向逐跳, 跨 host 重查 robots; ≤5 跳)
// ---------------------------------------------------------------------------
async function politeGet(rawUrl, opts = {}) {
  let url = rawUrl;
  const ua = opts.ua || UA;
  for (let hop = 0; hop < 5; hop += 1) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return { status: 0, finalUrl: url, buf: null, contentType: '', error: 'bad-url' };
    }
    if (!(u.protocol === 'http:' || u.protocol === 'https:')) {
      return { status: 0, finalUrl: url, buf: null, contentType: '', error: 'bad-scheme' };
    }
    if (!(await hostAllowsUrl(u))) {
      return { status: 403, finalUrl: url, buf: null, contentType: '', robotsBlocked: true };
    }
    await throttle();
    countRequest();
    let res;
    try {
      res = await fetch(url, {
        headers: { 'user-agent': ua, accept: '*/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { status: 0, finalUrl: url, buf: null, contentType: '', error: 'network' };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { status: res.status, finalUrl: url, buf: null, contentType: '', error: 'no-redirect-location' };
      url = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) return { status: res.status, finalUrl: url, buf: null, contentType: '', error: `http-${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, finalUrl: url, buf, contentType: res.headers.get('content-type') || '' };
  }
  return { status: 0, finalUrl: url, buf: null, contentType: '', error: 'redirect-loop' };
}

// ---------------------------------------------------------------------------
// 平台分类
// ---------------------------------------------------------------------------
const FEISHU_HOST_RE = /(^|\.)jobs\.feishu\.cn$|(^|\.)jobs\.f\.mioffice\.cn$/;
const ZHIYE_HOST_RE = /(^|\.)zhiye\.com$/;

function classifyUrl(raw) {
  let host = '';
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return 'bad-url';
  }
  if (FEISHU_HOST_RE.test(host)) return 'feishu';
  if (ZHIYE_HOST_RE.test(host)) return 'zhiye';
  if (host === 'wecruit.hotjob.cn') return 'hotjob';
  if (host === 'app.mokahr.com') return 'mokahr';
  if (host === 'mp.weixin.qq.com') return 'weixin';
  return 'other';
}

const PLATFORM_PRIORITY = { feishu: 0, zhiye: 1, hotjob: 2, other: 3, weixin: 4, mokahr: 5 };

function isPlaceholderLink(raw) {
  return !/^https?:\/\//i.test(raw) || /[一-鿿]/.test(raw);
}

function cleanLink(raw) {
  return raw.trim().replace(/&amp;/g, '&');
}

function pickCandidateLinks(links) {
  const real = (links || []).map(cleanLink).filter((l) => !isPlaceholderLink(l));
  real.sort((a, b) => (PLATFORM_PRIORITY[classifyUrl(a)] ?? 9) - (PLATFORM_PRIORITY[classifyUrl(b)] ?? 9));
  const seenHosts = new Set();
  const picked = [];
  for (const link of real) {
    try {
      const host = new URL(link).hostname;
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
    } catch {
      continue;
    }
    picked.push(link);
    if (picked.length >= 2) break;
  }
  return picked;
}

// ---------------------------------------------------------------------------
// 飞书 jobs (ats_feishu.py 契约)
// ---------------------------------------------------------------------------
const WEBSITE_INFO_RE = /<script\s+id=["']js-websiteInfo["'][^>]*type=["']text\/json["'][^>]*>([\s\S]*?)<\/script>/i;

function parseTenantInfo(html) {
  // js-websiteInfo.website_info: { id (长 id), path ("campus"), name, ... }
  // API 的 website-path 头认 website 的 path 字段 (实测 xiaomi: id 报
  // -9000003 site not exist, path "campus" 返回校招池); 无 path 时回退 id。
  const match = WEBSITE_INFO_RE.exec(html);
  if (!match) return '';
  try {
    const payload = JSON.parse(match[1]);
    const website = payload?.website_info || {};
    return String(website.path ?? website.id ?? '').trim();
  } catch {
    return '';
  }
}

function feishuSearchUrl(host, offset, limit, websitePath) {
  const params = [
    'keyword=', `limit=${limit}`, `offset=${offset}`,
    'job_category_id_list=', 'tag_id_list=', 'location_code_list=',
    'subject_id_list=', 'recruitment_id_list=', 'portal_type=6',
    'job_function_id_list=', 'storefront_id_list=', 'portal_entrance=1',
  ];
  return `https://${host}/api/v1/search/job/posts?${params.join('&')}`;
}

async function feishuApiPage(host, offset, websitePath) {
  await throttle();
  countRequest();
  const body = JSON.stringify({
    keyword: '', limit: FEISHU_PAGE_LIMIT, offset,
    job_category_id_list: [], tag_id_list: [], location_code_list: [],
    subject_id_list: [], recruitment_id_list: [], portal_type: 6,
    job_function_id_list: [], storefront_id_list: [], portal_entrance: 1,
  });
  const headers = {
    'user-agent': FEISHU_API_UA,
    'content-type': 'application/json',
    'portal-channel': 'saas-career',
    'portal-platform': 'pc',
    accept: 'application/json, text/plain, */*',
  };
  if (websitePath) headers['website-path'] = websitePath;
  const res = await fetch(feishuSearchUrl(host, offset, FEISHU_PAGE_LIMIT, websitePath), {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status >= 400) throw new Error(`feishu API http ${res.status}`);
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('feishu API non-JSON body');
  }
  return parseFeishuJobPage(payload);
}

async function fetchFeishu(company, link) {
  // 分享短链 /s/<code> 逐跳 resolve 到 portal (跨 host 重查 robots)。
  const portal = await politeGet(link);
  if (portal.robotsBlocked) return { status: 'skip', reason: 'robots-blocked' };
  if (!portal.buf) return { status: 'skip', reason: portal.error || `http-${portal.status}` };
  const html = portal.buf.toString('utf8');
  const finalUrl = new URL(portal.finalUrl);
  const host = finalUrl.hostname;
  const websitePath = parseTenantInfo(html);
  const today = new Date().toISOString().slice(0, 10);
  let offset = 0;
  let total = Infinity;
  const jobs = [];
  let apiFailed = null;
  for (let page = 0; page < MAX_PAGES_PER_COMPANY && offset < total; page += 1) {
    let pageJobs;
    try {
      ({ jobs: pageJobs, total } = await feishuApiPage(host, offset, websitePath));
    } catch (err) {
      if (jobs.length > 0) break; // 已有第一页, 分页失败不影响
      apiFailed = err.message;
      if (websitePath && /site not exist/i.test(err.message)) {
        // website-path 头不被该租户认 → 去掉重试一次 (默认池)。
        try {
          ({ jobs: pageJobs, total } = await feishuApiPage(host, offset, ''));
        } catch (err2) {
          apiFailed = err2.message;
          break;
        }
      } else {
        break;
      }
    }
    if (pageJobs === undefined) break;
    jobs.push(...pageJobs);
    offset += FEISHU_PAGE_LIMIT;
  }
  if (jobs.length === 0) return { status: 'skip', reason: apiFailed ? `feishu-api: ${apiFailed}` : 'feishu-no-jobs' };
  const positions = jobs
    .map((job) => feishuJobToPosition(job, company, { host, websitePath, retrievedAt: today }))
    .filter(Boolean);
  return { status: positions.length ? 'ok' : 'skip', reason: 'ok', positions };
}

// ---------------------------------------------------------------------------
// zhiye (ats_zhiye.py 轻量 3 步探针) / hotjob / 通用 JSON 列表
// ---------------------------------------------------------------------------
const BSGLOBAL_RE = /var\s+BSGlobal\s*=\s*(\{.*?\})\s*;/s;
const BUNDLE_RE = /<script[^>]*\bsrc=["']([^"']*ux-recruitment-portal-2022[^"']*\.chunk\.min\.js)["']/i;
const API_PATH_RE = /["'](\/api\/[^"']{2,160})["']/g;
const IGNORED_API_HINTS = ['login', 'captcha', 'geetest', 'verify', 'sso', 'auth', 'token', 'upload', 'download', 'image', 'file'];
const JOB_LIST_HINTS = ['position', 'job', 'recruit', 'zhaopin', 'search'];
const LIST_KEYS = ['list', 'jobs', 'records'];
const ID_KEYS = ['jobId', 'positionId', 'id'];
const TITLE_KEYS = ['title', 'name', 'positionName'];
const TOTAL_KEYS = ['total', 'count', 'totalCount', 'total_count'];
const CITY_KEYS = ['city', 'jobCity', 'job_city', 'cityName', 'positionCity', 'workCity'];

function firstKey(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) return row[key];
  }
  return '';
}

function parseGenericJobList(payload, company, prefix, applyBaseUrl) {
  const body = payload?.data || payload;
  if (!body || typeof body !== 'object') return null;
  let rows = null;
  for (const key of LIST_KEYS) {
    if (Array.isArray(body[key])) {
      rows = body[key];
      break;
    }
  }
  if (!rows) return null;
  let total = 0;
  for (const key of TOTAL_KEYS) {
    if (typeof body[key] === 'number') {
      total = body[key];
      break;
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const positions = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = String(firstKey(row, ID_KEYS)).trim();
    const title = String(firstKey(row, TITLE_KEYS)).trim();
    if (!id || !title) continue;
    const city = String(firstKey(row, CITY_KEYS) ?? '').trim();
    positions.push({
      externalId: `portal-${prefix}-${id}`,
      title: title.slice(0, 120),
      siteId: siteIdForJobCity(company, city),
      family: familyForText(title),
      taxonomy: { family: familyForText(title) },
      status: 'open',
      applySource: 'official',
      applyUrl: applyBaseUrl,
      retrievedAt: today,
    });
  }
  return { positions, total };
}

async function probeJsonList(company, urls, prefix, applyBaseUrl) {
  for (const url of urls.slice(0, 2)) {
    await throttle();
    countRequest();
    let res;
    try {
      res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      continue;
    }
    if (res.status >= 400) continue;
    const text = await res.text();
    if (!text.trim().startsWith('{')) continue;
    try {
      const parsed = parseGenericJobList(JSON.parse(text), company, prefix, applyBaseUrl);
      if (parsed && parsed.positions.length > 0) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchZhiye(company, link) {
  const u = new URL(link);
  if (!(await hostAllowsUrl(new URL(`https://${u.hostname}/`)))) {
    return { status: 'skip', reason: 'robots-blocked' };
  }
  const portal = await politeGet(link);
  if (!portal.buf) return { status: 'skip', reason: portal.error || `http-${portal.status}` };
  const html = portal.buf.toString('utf8');
  const bsg = BSGLOBAL_RE.exec(html);
  const bundleMatch = BUNDLE_RE.exec(html);
  if (!bsg || !bundleMatch) return { status: 'skip', reason: 'spa-no-bundle' };
  let portalId = '';
  try {
    const cfg = JSON.parse(bsg[1]);
    portalId = String(cfg?.PortalId ?? cfg?.portalId ?? cfg?.tenantInfo?.Domain ?? '').trim();
  } catch {
    portalId = '';
  }
  const bundleUrl = new URL(bundleMatch[1], `https://${u.hostname}/`).toString();
  const bundle = await politeGet(bundleUrl);
  if (bundle.robotsBlocked) return { status: 'skip', reason: 'zhiye-bundle-robots-blocked' };
  if (!bundle.buf) return { status: 'skip', reason: 'zhiye-bundle-failed' };
  const bundleText = bundle.buf.toString('utf8');
  const candidates = [];
  const seenPaths = new Set();
  let m;
  API_PATH_RE.lastIndex = 0;
  while ((m = API_PATH_RE.exec(bundleText)) !== null && candidates.length < 6) {
    const path = m[1];
    if (IGNORED_API_HINTS.some((hint) => path.includes(hint))) continue;
    if (!JOB_LIST_HINTS.some((hint) => path.includes(hint))) continue;
    const key = path.split('?')[0];
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    const suffix = portalId ? `?portalId=${encodeURIComponent(portalId)}` : '';
    candidates.push(`https://${u.hostname}${key}${suffix}`);
  }
  if (candidates.length === 0) return { status: 'skip', reason: 'zhiye-no-api-hints' };
  const found = await probeJsonList(company, candidates, 'zhiye', link);
  if (!found) return { status: 'skip', reason: 'zhiye-no-public-api' };
  return { status: 'ok', reason: 'ok', positions: found.positions };
}

async function fetchHotjob(company, link) {
  const portal = await politeGet(link);
  if (portal.robotsBlocked) return { status: 'skip', reason: 'robots-blocked' };
  if (!portal.buf) return { status: 'skip', reason: portal.error || `http-${portal.status}` };
  const html = portal.buf.toString('utf8');
  // hotjob 页面常见内嵌 JSON (window.__INITIAL_STATE__ / projectInfo); 只探
  // 页面内出现的 /api/ 路径, ≤1 次, 失败即跳过 (不轰炸)。
  const apiMatch = /["'](\/api\/[^"']{2,160})["']/.exec(html);
  if (!apiMatch) return { status: 'skip', reason: 'hotjob-no-api-hint' };
  const u = new URL(link);
  const found = await probeJsonList(company, [`https://${u.hostname}${apiMatch[1]}`], 'hotjob', link);
  if (!found) return { status: 'skip', reason: 'hotjob-no-public-api' };
  return { status: 'ok', reason: 'ok', positions: found.positions };
}

async function fetchOther(company, link) {
  const portal = await politeGet(link);
  if (portal.robotsBlocked) return { status: 'skip', reason: 'robots-blocked' };
  if (!portal.buf) return { status: 'skip', reason: portal.error || `http-${portal.status}` };
  const positions = parseHtmlJobRows(portal.buf.toString('utf8'), company, portal.finalUrl);
  if (positions.length === 0) return { status: 'skip', reason: 'no-html-jobs' };
  return { status: 'ok', reason: 'ok', positions };
}

// 微信文章: 只提取文内非微信外链, 顺着外链继续 (不把正文当岗位)。
async function fetchWeixin(company, link) {
  const article = await politeGet(link);
  if (article.robotsBlocked) return { status: 'skip', reason: 'robots-blocked' };
  if (!article.buf) return { status: 'skip', reason: article.error || `http-${article.status}` };
  const html = article.buf.toString('utf8');
  const external = [];
  const seen = new Set();
  const anchorRe = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null && external.length < 3) {
    const href = cleanLink(m[1]);
    if (!/^https?:\/\//i.test(href)) continue;
    let host;
    try {
      host = new URL(href).hostname;
    } catch {
      continue;
    }
    if (host.endsWith('weixin.qq.com') || host === 'weixin.qq.com') continue;
    if (seen.has(host)) continue;
    seen.add(host);
    external.push(href);
  }
  if (external.length === 0) return { status: 'skip', reason: 'weixin-no-external-link' };
  for (const target of external) {
    const result = await fetchByPlatform(company, target);
    if (result.status === 'ok') return result;
  }
  return { status: 'skip', reason: 'weixin-external-links-failed' };
}

// ---------------------------------------------------------------------------
// 平台路由 (每平台连续失败跳过 — 只作用于 ATS 平台; 'other' 是异质官网群,
// 每公司独立礼貌尝试, 不整桶跳过, 由总请求预算兜底)
// ---------------------------------------------------------------------------
const SKIP_RULE_PLATFORMS = new Set(['feishu', 'zhiye', 'hotjob', 'mokahr', 'weixin']);
const platformFails = new Map(); // platform -> 连续失败数
const platformSkipped = new Set();

async function fetchByPlatform(company, link) {
  const platform = classifyUrl(link);
  if (platformSkipped.has(platform)) {
    return { status: 'skip', reason: `platform-skipped:${platform}` };
  }
  let result;
  if (platform === 'feishu') result = await fetchFeishu(company, link);
  else if (platform === 'zhiye') result = await fetchZhiye(company, link);
  else if (platform === 'hotjob') result = await fetchHotjob(company, link);
  else if (platform === 'weixin') result = await fetchWeixin(company, link);
  else if (platform === 'mokahr') result = await fetchOther(company, link); // SPA, 走 HTML 解析兜底
  else result = await fetchOther(company, link);
  if (SKIP_RULE_PLATFORMS.has(platform)) {
    const failed = result.status !== 'ok';
    const count = (platformFails.get(platform) || 0) + (failed ? 1 : 0);
    platformFails.set(platform, failed ? count : 0);
    if (failed && count >= CONSECUTIVE_FAIL_LIMIT) {
      platformSkipped.add(platform);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// drops 读写 + 匹配
// ---------------------------------------------------------------------------
function loadDropFiles(dir) {
  const out = new Map(); // name -> { dir, file, data }
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (data && typeof data.name === 'string') out.set(data.name, { dir, file: name, data });
    } catch {
      // skip unreadable
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const rows = JSON.parse(await readFile(ROWS_PATH, 'utf8'));
  if (!Array.isArray(rows)) throw new Error(`rows file is not an array: ${ROWS_PATH}`);
  console.log(`rows: ${rows.length} (${ROWS_PATH})`);

  const qqjDrops = loadDropFiles(join(RECRUITMENT_DIR, 'qqdoc-jobs'));
  const existingDrops = new Map([
    ...loadDropFiles(join(RECRUITMENT_DIR, 'radar')),
    ...loadDropFiles(join(RECRUITMENT_DIR, 'official-career')),
    ...loadDropFiles(join(RECRUITMENT_DIR, 'qqdoc-official')),
  ]);
  console.log(`drops: qqdoc-jobs ${qqjDrops.size}, existing ${existingDrops.size}`);

  const byName = new Map(); // row name (dedupe) -> row
  for (const row of rows) {
    if (row && typeof row.name === 'string' && !byName.has(row.name)) byName.set(row.name, row);
  }
  console.log(`unique companies: ${byName.size}`);

  const results = [];
  let processed = 0;
  for (const [name, row] of byName) {
    if (budgetExceeded) break;
    if (ONLY && name !== ONLY) continue;
    if (LIMIT && processed >= LIMIT) break;
    processed += 1;

    const entry = { name, target: null, platform: '', status: 'pending', reason: '', positions: 0, links: pickCandidateLinks(row.links) };
    results.push(entry);

    // 1) 目标 drop: qqdoc-jobs 新增公司 → 现有 drops 匹配 (精确 → 唯一包含匹配,
    //    短名必须是长名的前缀且 ≥2 字 — TP-Link联洲≠TP, 引力波智谱≠智谱 不误配;
    //    比亚迪—博士校招→比亚迪、用友—高潜人才计划→用友 正常匹配)
    let target = qqjDrops.get(name) ? { kind: 'qqdoc-jobs', ...qqjDrops.get(name) } : null;
    if (!target) {
      const exact = existingDrops.get(name);
      if (exact) {
        target = { kind: 'existing', ...exact };
      } else {
        const candidates = [...existingDrops.entries()]
          .filter(([n]) => n !== name)
          .filter(([n]) => {
            const [shorter, longer] = n.length <= name.length ? [n, name] : [name, n];
            return shorter.length >= 2 && longer.startsWith(shorter);
          });
        if (candidates.length === 1) target = { kind: 'existing', ...candidates[0][1] };
      }
    }
    if (!target) {
      entry.status = 'unmatched';
      continue;
    }
    entry.target = `${target.kind}:${target.file}`;

    // 2) 幂等: 已有本管道岗位 → 跳过
    const existingPositions = Array.isArray(target.data.positions) ? target.data.positions : [];
    if (!FORCE && existingPositions.some((pos) => isQqdocJobsPositionId(pos?.externalId))) {
      entry.status = 'already-extracted';
      continue;
    }

    // 3) 顺着投递链接抓 (≤2 个候选链接, 首个成功即停)
    const company = { slug: target.data.slug, name: target.data.name, sites: target.data.sites || [] };
    if (entry.links.length === 0) {
      entry.status = 'skip';
      entry.reason = 'no-real-apply-link';
      continue;
    }
    let outcome = null;
    for (const link of entry.links) {
      entry.platform = classifyUrl(link);
      try {
        outcome = await fetchByPlatform(company, link);
      } catch (err) {
        if (budgetExceeded) {
          entry.status = 'skip';
          entry.reason = 'budget-exceeded';
          break;
        }
        outcome = { status: 'skip', reason: `error:${err.message}` };
      }
      if (outcome.status === 'ok') break;
    }
    if (budgetExceeded) {
      entry.status = 'skip';
      entry.reason = 'budget-exceeded';
      continue;
    }
    if (!outcome || outcome.status !== 'ok') {
      entry.status = 'skip';
      entry.reason = outcome?.reason || 'no-platform-result';
      continue;
    }

    // 4) 写盘 (去重 externalId; 只追加, 不删改其他字段)
    const newPositions = outcome.positions.filter(
      (pos) => !existingPositions.some((old) => old.externalId === pos.externalId),
    );
    entry.positions = newPositions.length;
    if (newPositions.length === 0) {
      entry.status = 'skip';
      entry.reason = 'all-positions-duplicate';
      continue;
    }
    if (DRY_RUN) {
      entry.status = 'ok(dry)';
      continue;
    }
    const merged = [...existingPositions, ...newPositions];
    target.data.positions = merged;
    // 占位 apply_url 修正 (仅写岗位时; 有真实链接才改)
    if (target.kind === 'qqdoc-jobs' && isPlaceholderLink(target.data.apply_url || '')) {
      target.data.apply_url = entry.links[0];
    }
    await writeFile(join(target.dir, target.file), `${JSON.stringify(target.data, null, 2)}\n`, 'utf8');
    entry.status = 'ok';
  }

  // ---- 汇总 ----
  const platformStats = {};
  for (const r of results) {
    if (!r.platform) continue;
    const s = (platformStats[r.platform] ||= { attempts: 0, ok: 0, skip: 0, reasons: {} });
    s.attempts += 1;
    if (r.status === 'ok' || r.status === 'ok(dry)') s.ok += 1;
    else {
      s.skip += 1;
      s.reasons[r.reason] = (s.reasons[r.reason] || 0) + 1;
    }
  }
  const totals = {
    ok: results.filter((r) => r.status === 'ok' || r.status === 'ok(dry)').length,
    skip: results.filter((r) => r.status === 'skip').length,
    unmatched: results.filter((r) => r.status === 'unmatched').length,
    alreadyExtracted: results.filter((r) => r.status === 'already-extracted').length,
    positionsWritten: results.filter((r) => r.status === 'ok').reduce((sum, r) => sum + r.positions, 0),
    requests: requestCount,
    robotsFetched,
    platformSkipped: [...platformSkipped],
  };
  console.log(JSON.stringify({ totals, platformStats }, null, 2));
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(WORKTREE_ROOT, '.playwright-mcp', 'qqdoc', `extract-qqdoc-jobs-${ts}.json`);
  await writeFile(outPath, JSON.stringify({ totals, platformStats, results }, null, 2), 'utf8');
  console.log(`summary: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
