#!/usr/bin/env node
// extract-embodied-jobs.mjs — 解析 Embodied-AI 岗位列表快照 → 招聘 drops
// (20260821-boss-embodied-jobs 批次 ws1; 纯解析, 零网络抓取, 零依赖)。
//
// 数据源: github.com/Octoday-Hub/Embodied-AI topics/02-jobs.md
//   (具身智能岗位聚合列表, 2026-08-21 快照, 只读引用; 文件无 LICENSE, 社区
//   维护列表 — 授权口径见 ws2 ETL 文档, 本脚本不做网络请求)。
//
// 结构: 三个岗位节 (`## 国内机会` / `## Overseas Opportunities` / `## 人才计划`,
//   `## HR专属通道` 无岗位, 跳过) 内嵌 HTML `<table>`: 公司 `<td rowspan=N>` 一格
//   + N 个岗位行, 5 列 = 公司/岗位/类型/地点/投递; 每岗行投递格内一个 `<a href>`
//   (button 图 ../files/deliver-button.svg 只是装饰, 链接以 href 为准)。
//   需跳过的行: 字母锚点行 (colspan=5 单格)、「链接直达」导航表 (2 格)、
//   `<th>` 表头行 (tbody 内 公司/岗位/类型/地点/投递 5 格 — 数据里每节各一行)。
//
// 映射: 类型格 → JobFamily — 社招→social 校招→campus 实习→intern; 英文标签
//   Full-time/Permanent/Contract→social, New Grad→campus, Internship→intern。
//   无法映射 (未标注/专项/空/Postdoc…) → 岗位名关键词推断
//   (实习|Intern|暑期|训练营→intern; 校招|Campus|应届→campus), 再兜底 social。
//   多标签「校招/实习」→ campus (校招优先, 2026-08-21 决策)。
//
// 链接: 每行取第一个 http(s) href; 行无链接 → 岗位 applyUrl 用该公司首个有效
//   链接兜底; 公司零链接 → 该 drop 不写 positions (positions: [])。
//
// 产出:
//   - 无同名匹配的公司 → 新建 server/data/recruitment/embodied-jobs/embj-<名>.json
//     (source: 'embodied-jobs', 一个聚合 site, city = 岗位城市并集空格分隔)。
//   - 同名匹配 (name 精确相等, 兜底唯一前缀包含别名且 ≥2 字) → 在现有 drop
//     追加 positions (externalId 仍 embj-<名>-<n>, siteId = 该 drop 首个 site);
//     该 drop 有 sources 数组 → 追加 'embodied-jobs' (source 单值不动)。
//   - 跨节同名公司 (如 地平线 国内+专项) 合并为一个 drop, 岗位合并。
//
// 幂等: 已存在 embj-<名>.json → 跳过该公司; 匹配 drop 里已有 embj- 前缀
//   externalId 的岗位 → 跳过。可重复运行。
//
// 用法: node scripts/extract-embodied-jobs.mjs [--dry-run]
//   [--snapshot=<path>]   --dry-run 只统计不写盘。

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKTREE_ROOT = join(SCRIPT_DIR, '..', '..'); // server/scripts → server → worktree 根
const RECRUITMENT_DIR = join(WORKTREE_ROOT, 'server', 'data', 'recruitment');
const EMBJ_DIR = join(RECRUITMENT_DIR, 'embodied-jobs');
const SNAPSHOT_DEFAULT =
  '/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-embodied-jobs/source/embodied-02-jobs.md';
const RETRIEVED_AT = '2026-08-21';
/** 同名匹配扫描的现有 drops 目录 (boss/nowcoder/shixiseng 为空目录, 跳过)。 */
const MATCH_DIRS = ['radar', 'official-career', 'qqdoc-official', 'qqdoc-jobs'];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SNAPSHOT_PATH = args.find((a) => a.startsWith('--snapshot='))?.slice('--snapshot='.length) || SNAPSHOT_DEFAULT;

// ---------------------------------------------------------------------------
// HTML 表格解析 (快照是 md 文件内嵌 HTML table, 非 markdown 表)
// ---------------------------------------------------------------------------
function htmlDecode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** 快照 sha256 (2026-08-21 快照 = d862c540ed3d7ee7c0ed53dd2dbfb2b3798de6fa50b07fd45891df2e804d79ff)。 */
function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function cellText(inner) {
  return htmlDecode(inner.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

const TR_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
const CELL_RE = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;

/**
 * 解析一段 md 里的全部 `<tr>`, 每行拆成 cell 数组。
 * cell: { isTh, rowspan, colspan, text, hrefs } — hrefs 为原样 href 属性列表。
 */
export function parseTableRows(text) {
  const rows = [];
  for (const m of text.matchAll(TR_RE)) {
    const cells = [];
    CELL_RE.lastIndex = 0;
    let rm;
    while ((rm = CELL_RE.exec(m[1])) !== null) {
      const openTag = rm[0].slice(0, rm[0].indexOf('>'));
      const rowspanMatch = /rowspan="?(\d+)"?/.exec(openTag);
      const colspanMatch = /colspan="?(\d+)"?/.exec(openTag);
      const hrefs = [...rm[1].matchAll(/href="([^"]+)"/g)].map((h) => h[1]);
      cells.push({
        isTh: /^<th\b/i.test(rm[0]),
        rowspan: rowspanMatch ? Number(rowspanMatch[1]) : 1,
        colspan: colspanMatch ? Number(colspanMatch[1]) : 1,
        text: cellText(rm[1]),
        hrefs,
      });
    }
    rows.push(cells);
  }
  return rows;
}

/** 公司行 (5 格, 首格非 th) → { name, row }。 */
function isCompanyRow(row) {
  return row.length === 5 && !row[0].isTh && row[0].colspan === 1 && row[0].text.length > 0;
}

/** 岗位行 (4 格)。 */
function isJobRow(row) {
  return row.length === 4 && !row[0].isTh;
}

/** 4 格 (岗位/类型/地点/投递) → job 记录。 */
function jobFromCells(cells) {
  return {
    title: cells[0]?.text ?? '',
    typeText: cells[1]?.text ?? '',
    cityText: cells[2]?.text ?? '',
    href: firstHttpHref(cells[3]?.hrefs ?? []),
  };
}

/** 取第一个 http(s) 链接 (按钮图 img src 不算, 以 href 为准)。 */
function firstHttpHref(hrefs) {
  for (const raw of hrefs || []) {
    const h = htmlDecode(raw).trim();
    if (/^https?:\/\//i.test(h)) return h;
  }
  return null;
}

/**
 * 把一段 (单节) 表格行流分组为公司列表:
 * 公司行 (5 格, rowspan) 开启新组, 自身携带第 1 个岗位; 后续 4 格行追加岗位;
 * 锚点行 (1 格 colspan) / 导航表 (2 格) / th 行 / 孤儿岗位行 一律跳过。
 * 返回 [{ name, jobs: [{ title, typeText, cityText, href }] }]
 */
export function parseCompanies(rows) {
  const companies = [];
  let current = null;
  let orphanRows = 0;
  for (const row of rows) {
    if (isCompanyRow(row)) {
      if (current) companies.push(current);
      current = { name: row[0].text, jobs: [jobFromCells(row.slice(1))] };
    } else if (isJobRow(row)) {
      if (current) {
        current.jobs.push(jobFromCells(row));
      } else {
        orphanRows += 1; // 无归属公司的岗位行 — 数据异常, 跳过
      }
    }
    // 其他行 (锚点/导航/th/未知格数) 忽略
  }
  if (current) companies.push(current);
  return { companies, orphanRows };
}

// ---------------------------------------------------------------------------
// 类型 → JobFamily 映射
// ---------------------------------------------------------------------------
const TITLE_INTERN_RE = /实习|intern|暑期|训练营/i;
const TITLE_CAMPUS_RE = /校招|campus|应届/i;

/**
 * 类型格 → JobFamily。无法直接映射时从岗位名关键词推断, 再兜底 social。
 * 直接映射 (2026-08-21 决策):
 *   社招→social; 校招→campus (含「校招/实习」多标签, 校招优先);
 *   实习→intern; Full-time/Permanent/Contract→social; New Grad→campus;
 *   Internship→intern。
 */
export function familyForType(typeText, title = '') {
  const t = typeText.trim();
  if (t.includes('社招')) return 'social';
  if (t.includes('校招')) return 'campus';
  if (t.includes('实习')) return 'intern';
  if (/full.?time|permanent|contract/i.test(t)) return 'social';
  if (/new.?grad|graduate|entry.?level/i.test(t)) return 'campus';
  if (/intern/i.test(t)) return 'intern';
  // 无法映射 (未标注/专项/空/Postdoc…) → 岗位名关键词推断
  if (TITLE_INTERN_RE.test(title)) return 'intern';
  if (TITLE_CAMPUS_RE.test(title)) return 'campus';
  return 'social'; // 兜底
}

// ---------------------------------------------------------------------------
// 城市并集
// ---------------------------------------------------------------------------
/**
 * 城市文本并集 (去重, 空格分隔)。分隔符: /、；; 恒拆分; 半/全角逗号只在
 * 无 ASCII 字母时拆分 (中文 "上海市,芜湖市" 是分隔符, 英文 "San Jose, CA"
 * 是城市名内部逗号, 不拆)。
 */
export function unionCities(cityTexts) {
  const seen = new Set();
  const out = [];
  for (const text of cityTexts) {
    const parts = /[A-Za-z]/.test(text)
      ? text.split(/[/、；;]/)
      : text.split(/[/、；;，,]/);
    for (const part of parts) {
      const city = part.trim();
      if (!city || seen.has(city)) continue;
      seen.add(city);
      out.push(city);
    }
  }
  return out.join(' ');
}

// ---------------------------------------------------------------------------
// drops 读写 + 同名匹配
// ---------------------------------------------------------------------------
function loadDropFiles(dir) {
  const out = new Map(); // name -> { dir, file, data }
  return readdir(dir)
    .then((names) => {
      for (const name of names.sort()) {
        if (!name.endsWith('.json')) continue;
        out.set(name, { dir, file: name });
      }
      return out;
    })
    .catch(() => out);
}

/**
 * 同名匹配: 精确相等 → exact; 否则唯一前缀包含别名 (短名 ≥2 字, 长名以短名
 * 开头, 如 「九号」→「九号公司」/「荣耀」→「荣耀HONOR」) → alias;
 * 多候选或未命中 → null (新建 embj-* drop; 多候选记入汇报由 boss 裁决)。
 */
export function matchCompany(name, existing) {
  const exact = existing.get(name);
  if (exact) return { kind: 'exact', entry: exact };
  const candidates = [...existing.entries()]
    .filter(([en]) => en !== name && en.length >= 2 && name.length >= 2 && (en.startsWith(name) || name.startsWith(en)));
  if (candidates.length === 1) return { kind: 'alias', entry: candidates[0][1], matchedName: candidates[0][0] };
  if (candidates.length > 1) return { kind: 'ambiguous', candidates: candidates.map(([en]) => en) };
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const SECTIONS = [
  { key: 'domestic', start: '## 国内机会', end: '## Overseas Opportunities', label: '国内' },
  { key: 'overseas', start: '## Overseas Opportunities', end: '## 人才计划', label: '海外' },
  { key: 'special', start: '## 人才计划', end: '## HR专属通道', label: '专项' },
];

export async function main() {
  await mkdir(EMBJ_DIR, { recursive: true }); // 输出目录 (已存在则幂等)
  const text = await readFile(SNAPSHOT_PATH, 'utf8');
  console.log(`snapshot: ${SNAPSHOT_PATH} (sha256 ${sha256Of(SNAPSHOT_PATH)}, ${text.length} chars)`);

  // 1) 节切分 + 解析
  const stats = {
    companies: 0,
    jobs: 0,
    perSection: {},
    orphanRows: 0,
  };
  const companiesBySection = {};
  for (const sec of SECTIONS) {
    const startAt = text.indexOf(sec.start);
    if (startAt === -1) throw new Error(`section header not found: ${sec.start}`);
    const endAt = sec.end ? text.indexOf(sec.end) : text.length;
    if (endAt === -1) throw new Error(`section end not found: ${sec.end}`);
    const { companies, orphanRows } = parseCompanies(parseTableRows(text.slice(startAt, endAt)));
    companiesBySection[sec.key] = companies;
    stats.perSection[sec.key] = {
      companies: companies.length,
      jobs: companies.reduce((n, c) => n + c.jobs.length, 0),
    };
    stats.orphanRows += orphanRows;
  }

  // 2) 跨节同名合并 (地平线 国内+专项 / NVIDIA 海外+专项 / 商汤科技 国内+专项)
  const byName = new Map(); // name -> company (岗位按节顺序合并)
  const mergedSections = new Map(); // name -> [section keys]
  for (const sec of SECTIONS) {
    for (const company of companiesBySection[sec.key]) {
      const existing = byName.get(company.name);
      if (existing) {
        existing.jobs.push(...company.jobs);
        mergedSections.get(company.name).push(sec.key);
      } else {
        byName.set(company.name, { name: company.name, jobs: [...company.jobs] });
        mergedSections.set(company.name, [sec.key]);
      }
    }
  }
  const companies = [...byName.values()];
  stats.companies = companies.length;
  stats.jobs = companies.reduce((n, c) => n + c.jobs.length, 0);
  const mergedAcrossSections = [...mergedSections.entries()].filter(([, v]) => v.length > 1);
  console.log(
    `sections: ${Object.entries(stats.perSection)
      .map(([k, v]) => `${k}=${v.companies}家/${v.jobs}岗`)
      .join(' ')} | 合并跨节同名: ${mergedAcrossSections.map(([n, v]) => `${n}(${v.join('+')})`).join(', ') || '无'}`,
  );
  console.log(`companies total: ${stats.companies} (jobs ${stats.jobs})`);

  // 3) 读现有 drops (同名匹配用) + 已生成的 embj drops (幂等跳过用)
  const existing = new Map();
  for (const dir of MATCH_DIRS) {
    const dirPath = join(RECRUITMENT_DIR, dir);
    const files = await loadDropFiles(dirPath);
    for (const [file, entry] of files) {
      try {
        const data = JSON.parse(await readFile(join(dirPath, file), 'utf8'));
        if (data && typeof data.name === 'string') {
          existing.set(data.name, { dir: dirPath, file, data });
        }
      } catch {
        // 跳过坏文件 (import 规划器会另行报告)
      }
    }
  }
  const existingEmbjFiles = await loadDropFiles(EMBJ_DIR);
  console.log(`existing drops for matching: ${existing.size}; existing embj drops: ${existingEmbjFiles.size}`);

  // 4) 逐公司生成
  const results = [];
  let positionsWritten = 0;
  let typeInferred = 0;
  let typeFallback = 0;
  let noLinkRows = 0;
  let zeroLinkCompanies = 0;
  let skippedExisting = 0;
  const ambiguousNames = [];

  for (const company of companies) {
    const name = company.name;
    const embjFile = `embj-${name}.json`;

    // 幂等 1: embj-<名>.json 已存在 → 跳过
    if (existingEmbjFiles.has(embjFile)) {
      results.push({ name, action: 'skipped-embj-exists' });
      skippedExisting += 1;
      continue;
    }

    // 同名匹配 (精确 → 唯一前缀别名 → 多候选记 ambiguous → 未命中)
    const match = matchCompany(name, existing);
    if (match.kind === 'ambiguous') ambiguousNames.push({ name, candidates: match.candidates });
    let target = match.kind === 'exact' || match.kind === 'alias' ? match.entry : null;

    // 幂等 2: 匹配 drop 里已有 embj- 前缀岗位 → 跳过 (可重复运行)
    if (
      target &&
      Array.isArray(target.data.positions) &&
      target.data.positions.some((p) => typeof p?.externalId === 'string' && p.externalId.startsWith('embj-'))
    ) {
      results.push({ name, action: 'skipped-embj-positions', target: target.file });
      skippedExisting += 1;
      continue;
    }

    // 链接兜底: 行无链接 → 该公司首个有效链接; 公司零链接 → 不产岗位
    const firstValidLink = company.jobs.map((j) => j.href).find(Boolean) ?? null;
    if (firstValidLink === null) {
      zeroLinkCompanies += 1;
      if (target) {
        // 匹配 drop 不追加无投递链接的岗位 (记录, 由 boss 裁决)
        results.push({ name, action: 'skipped-zero-link-matched', target: target.file });
        continue;
      }
    }

    // 生成岗位 (externalId embj-<名>-<n>, n 从 1 按节顺序递增)
    const positions = [];
    let n = 1;
    for (const job of company.jobs) {
      if (!job.title) continue; // 空岗位名防御 (数据里不存在)
      const family = familyForType(job.typeText, job.title);
      const directType =
        job.typeText.includes('社招') || job.typeText.includes('校招') || job.typeText.includes('实习') ||
        /full.?time|permanent|contract|new.?grad|graduate|intern/i.test(job.typeText);
      if (!directType) {
        // 类型格未能直接映射 → 岗位名关键词推断 / social 兜底计数
        if (TITLE_INTERN_RE.test(job.title) || TITLE_CAMPUS_RE.test(job.title)) typeInferred += 1;
        else typeFallback += 1;
      }
      if (!job.href) noLinkRows += 1;
      positions.push({
        externalId: `embj-${name}-${n}`,
        title: job.title,
        siteId: null, // 下面按 target 有无填
        family,
        taxonomy: { family },
        status: 'open',
        applySource: 'official',
        applyUrl: job.href ?? firstValidLink,
        retrievedAt: RETRIEVED_AT,
      });
      n += 1;
    }

    // 写盘: 匹配 drop 追加 (siteId = 其首个 site)
    if (target) {
      const siteId = target.data.sites?.[0]?.id;
      if (siteId === undefined) {
        target = null; // 匹配 drop 无 site — 退化走新建
      } else {
        const existingPositions = Array.isArray(target.data.positions) ? target.data.positions : [];
        const newPositions = positions
          .filter((p) => !existingPositions.some((old) => old.externalId === p.externalId))
          .map((p) => ({ ...p, siteId }));
        if (newPositions.length > 0) {
          if (Array.isArray(target.data.sources) && !target.data.sources.includes('embodied-jobs')) {
            target.data.sources.push('embodied-jobs');
          }
          target.data.positions = [...existingPositions, ...newPositions];
          if (!DRY_RUN) {
            await writeFile(join(target.dir, target.file), `${JSON.stringify(target.data, null, 2)}\n`, 'utf8');
          }
          positionsWritten += newPositions.length;
          results.push({
            name,
            action: match.kind === 'alias' ? 'appended-alias' : 'appended',
            matchName: match.kind === 'alias' ? match.matchedName : name,
            target: target.file,
            positions: newPositions.length,
            sources: Array.isArray(target.data.sources) ? [...target.data.sources] : undefined,
          });
        } else {
          results.push({ name, action: 'all-duplicate', target: target.file });
        }
        continue;
      }
    }

    // 新建 embj drop (零链接公司 → positions: [], 记入汇报)
    const siteId = `embj-${name}-site`;
    const drop = {
      slug: `embj-${name}`,
      source: 'embodied-jobs',
      name,
      sites: [
        {
          id: siteId,
          name,
          city: unionCities(company.jobs.map((j) => j.cityText)),
          province: '',
          location: {},
        },
      ],
    };
    if (firstValidLink) drop.careerUrl = firstValidLink;
    drop.positions = firstValidLink ? positions.map((p) => ({ ...p, siteId })) : [];
    if (!DRY_RUN) {
      await writeFile(join(EMBJ_DIR, embjFile), `${JSON.stringify(drop, null, 2)}\n`, 'utf8');
    }
    positionsWritten += drop.positions.length;
    results.push({
      name,
      action: firstValidLink ? 'new' : 'new-zero-link',
      file: embjFile,
      positions: drop.positions.length,
    });
  }

  // 5) 汇总
  const totals = {
    companies: stats.companies,
    jobs: stats.jobs,
    perSection: stats.perSection,
    orphanRows: stats.orphanRows,
    mergedAcrossSections: mergedAcrossSections.map(([n, v]) => `${n}(${v.join('+')})`),
    newDrops: results.filter((r) => r.action === 'new' || r.action === 'new-zero-link').length,
    newDropsZeroLink: results.filter((r) => r.action === 'new-zero-link').length,
    appended: results.filter((r) => r.action === 'appended' || r.action === 'appended-alias').length,
    appendedAlias: results.filter((r) => r.action === 'appended-alias').map((r) => `${r.name}→${r.matchName}`),
    ambiguous: ambiguousNames,
    skipped: skippedExisting,
    positionsWritten,
    typeInferred,
    typeFallback,
    noLinkRows,
    zeroLinkCompanies,
  };
  console.log(JSON.stringify({ totals, results }, null, 2));
  return totals;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
