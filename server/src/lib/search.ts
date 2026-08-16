// ============================================================
// 搜索 / 筛选 / 排序纯逻辑
//
// 设计遵循 tech/10-search-filter.md：
// - 纯函数、无副作用，便于单元测试
// - 组合搜索：关键词 + 标签 + 筛选器 + 空间范围
// ============================================================

import type { FilterConfig, FilterOption, FilterState, MapMode, POI, SortOption } from './types.ts';
import { isRecruitmentPOI } from './types.ts';
import { getMode } from './modes.ts';
import { positionMatchesTaxonomySelection, selectedTaxonomyPaths } from './job-taxonomy.ts';
import { HANGZHOU_DISTRICTS, poiMatchesDistrict } from './spatial-filters.ts';
import { categoryMatches, popularityScore } from './viewport-search.ts';

// ---- 关键词匹配 ----

/** 行业 code → 中文标签（用于搜索匹配） */
const INDUSTRY_LABELS: Record<string, string> = {
  internet: '互联网',
  finance: '金融',
  consulting: '咨询',
  hardware: '硬件制造 硬件',
  ai: '人工智能 AI',
  ecommerce: '电商 电子商务',
  game: '游戏',
  automotive: '汽车',
  biotech: '生物医药',
  consumer: '消费品',
  transport: '出行 交通',
  content: '内容 内容平台',
};

/** 搜索框里的 #标签 → 筛选键。 intern/campus/social 走 taxonomy 插件。 */
export const TAG_FILTERS: Record<string, { key: string; value: string }> = {
  大厂: { key: 'scale', value: 'bigtech' },
  独角兽: { key: 'scale', value: 'unicorn' },
  创业: { key: 'scale', value: 'startup' },
  创业公司: { key: 'scale', value: 'startup' },
  大型企业: { key: 'scale', value: 'enterprise' },
  互联网: { key: 'industry', value: 'internet' },
  金融: { key: 'industry', value: 'finance' },
  咨询: { key: 'industry', value: 'consulting' },
  硬件: { key: 'industry', value: 'hardware' },
  人工智能: { key: 'industry', value: 'ai' },
  ai: { key: 'industry', value: 'ai' },
  电商: { key: 'industry', value: 'ecommerce' },
  游戏: { key: 'industry', value: 'game' },
  汽车: { key: 'industry', value: 'automotive' },
  实习: { key: 'jobTaxonomy', value: 'intern' },
  校招: { key: 'jobTaxonomy', value: 'campus' },
  社招: { key: 'jobTaxonomy', value: 'social' },
  暑期实习: { key: 'jobTaxonomy', value: 'intern/summer' },
  日常实习: { key: 'jobTaxonomy', value: 'intern/daily' },
  秋招: { key: 'jobTaxonomy', value: 'campus/autumn' },
  春招: { key: 'jobTaxonomy', value: 'campus/spring' },
  ...districtTagFilters(),
};

/** Full 西湖区 is a plugin; bare 西湖 stays a Domain keyword for the lake. */
function districtTagFilters(): Record<string, { key: string; value: string }> {
  const out: Record<string, { key: string; value: string }> = {};
  for (const district of HANGZHOU_DISTRICTS) {
    out[district.value] = { key: 'district', value: district.value };
    if (district.value !== '西湖区') {
      out[district.label] = { key: 'district', value: district.value };
    }
  }
  return out;
}

export interface SearchTagSuggestion {
  id: string;
  label: string;
  title: string;
  key: string;
  value: string;
}

/** Unique plugin tags (创业 / 创业公司 collapse to one). */
export function listSearchTags(): SearchTagSuggestion[] {
  const seen = new Set<string>();
  const out: SearchTagSuggestion[] = [];
  for (const [label, mapped] of Object.entries(TAG_FILTERS)) {
    const id = `tag-${mapped.key}-${mapped.value}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, title: `#${label}`, key: mapped.key, value: mapped.value });
  }
  return out;
}

/** Match typed text (with or without #) against known FilterPlugin tags. */
export function suggestSearchTags(query: string, limit = 5): SearchTagSuggestion[] {
  const q = query.trim().replace(/^#/, '').toLowerCase();
  if (!q || limit <= 0) return [];
  return listSearchTags()
    .filter((tag) => tag.label.toLowerCase().includes(q) || tag.value.toLowerCase().includes(q) || tag.key.toLowerCase().includes(q))
    .slice(0, limit);
}

function optionLabel(options: FilterOption[] | undefined, value: string): string | undefined {
  if (!options) return undefined;
  for (const option of options) {
    if (option.value === value) return option.label;
    const nested = optionLabel(option.children, value);
    if (nested) return nested;
  }
  return undefined;
}

function chipTitle(config: FilterConfig, value: string): string {
  const hashed = listSearchTags().find((tag) => tag.key === config.key && tag.value === value);
  if (hashed) return hashed.title;
  const named = optionLabel(config.options, value);
  if (named) return named;
  return `${config.label} ${value}${config.unit ? config.unit : ''}`;
}

/** Chips for every applied filter. Pass mode configs so district / salary / distance show too. */
export function activeFilterChips(filters: FilterState, configs?: FilterConfig[]): SearchTagSuggestion[] {
  if (!configs?.length) {
    const chips: SearchTagSuggestion[] = [];
    for (const tag of listSearchTags()) {
      const raw = filters[tag.key];
      const values = Array.isArray(raw)
        ? raw.filter((item): item is string => typeof item === 'string')
        : typeof raw === 'string' && raw
          ? [raw]
          : [];
      if (values.includes(tag.value)) chips.push(tag);
    }
    return chips;
  }

  const chips: SearchTagSuggestion[] = [];
  for (const config of configs) {
    const raw = filters[config.key];
    if (raw === undefined || raw === null || raw === '' || raw === false) continue;
    if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number') {
      const value = `${raw[0]}-${raw[1]}`;
      chips.push({
        id: `chip-${config.key}-${value}`,
        label: config.label,
        title: `${config.label} ${raw[0]}–${raw[1]}${config.unit ?? ''}`,
        key: config.key,
        value,
      });
      continue;
    }
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item !== 'string' || !item) continue;
        chips.push({
          id: `chip-${config.key}-${item}`,
          label: config.label,
          title: chipTitle(config, item),
          key: config.key,
          value: item,
        });
      }
      continue;
    }
    if (typeof raw === 'number') {
      if (raw === 0 && (config.key === 'distance' || config.key === 'minRating')) continue;
      const value = String(raw);
      chips.push({
        id: `chip-${config.key}-${value}`,
        label: config.label,
        title: `${config.label} ${value}${config.unit ?? ''}`,
        key: config.key,
        value,
      });
      continue;
    }
    if (typeof raw === 'string') {
      chips.push({
        id: `chip-${config.key}-${raw}`,
        label: config.label,
        title: chipTitle(config, raw),
        key: config.key,
        value: raw,
      });
    }
  }
  return chips;
}

/** Drop one plugin value. Empty keys are removed so the badge / pipeline stay clean. */
export function removeFilterChip(filters: FilterState, chip: Pick<SearchTagSuggestion, 'key' | 'value'>): FilterState {
  const next: FilterState = { ...filters };
  const raw = next[chip.key];
  if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number') {
    if (`${raw[0]}-${raw[1]}` === chip.value) delete next[chip.key];
    return next;
  }
  if (Array.isArray(raw)) {
    const kept = raw.filter((item): item is string => typeof item === 'string' && item !== chip.value);
    if (kept.length) next[chip.key] = kept;
    else delete next[chip.key];
    return next;
  }
  if (typeof raw === 'number' && String(raw) === chip.value) {
    delete next[chip.key];
    return next;
  }
  if (raw === chip.value || raw === true) delete next[chip.key];
  return next;
}

export interface ParsedSearchQuery {
  text: string;
  tags: string[];
  filters: FilterState;
}

export const DISTANCE_SLIDER = {
  min: 0,
  max: 10,
  step: 0.5,
} as const;

/** 距离筛选滑块（km）→ 米。未设或 ≤0 表示不画圈、不裁。 */
export function distanceFilterMeters(filters?: FilterState): number {
  const value = filters?.distance;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1000);
}

/** 把拖出来的半径米数扣回滑块步长。小于半步视为关掉距离圈。 */
export function metersToDistanceKm(
  meters: number,
  opts: { min?: number; max?: number; step?: number } = {},
): number {
  const min = opts.min ?? DISTANCE_SLIDER.min;
  const max = opts.max ?? DISTANCE_SLIDER.max;
  const step = opts.step ?? DISTANCE_SLIDER.step;
  if (!Number.isFinite(meters) || meters <= 0) return min;
  const snapped = Math.round(meters / 1000 / step) * step;
  if (snapped < step / 2) return min;
  return Math.min(max, Math.max(step, snapped));
}

/** 圆心正东 `meters` 处，给距离圈边缘把手用。 */
export function pointAtDistanceEast(
  origin: { lng: number; lat: number },
  meters: number,
): { lng: number; lat: number } {
  const metersPerDeg = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  if (!Number.isFinite(metersPerDeg) || Math.abs(metersPerDeg) < 1) {
    return { lng: origin.lng, lat: origin.lat };
  }
  return { lng: origin.lng + meters / metersPerDeg, lat: origin.lat };
}

/** 空结果时逐步放宽：距离 → 其他筛选 → 关键词。 */
export function widenSearchScope(input: {
  query: string;
  filters: FilterState;
}): { query: string; filters: FilterState; changed: boolean } {
  const nextFilters = { ...input.filters };
  if (typeof nextFilters.distance === "number" && nextFilters.distance > 0) {
    delete nextFilters.distance;
    return { query: input.query, filters: nextFilters, changed: true };
  }
  if (Object.keys(nextFilters).length > 0) {
    return { query: input.query, filters: {}, changed: true };
  }
  if (input.query.trim()) {
    return { query: "", filters: {}, changed: true };
  }
  return { query: input.query, filters: input.filters, changed: false };
}

/**
 * Turn a picked `#大厂` / `#互联网` suggestion into a FilterPlugin.
 * Known tags merge into filters and clear the typed query so the list
 * is not AND-ed against the same word twice. Unknown hashes stay text.
 */
export function applyTagSuggestion(
  current: { query: string; filters: FilterState },
  raw: string,
): { query: string; filters: FilterState; applied: boolean } {
  const token = raw.trim();
  if (!token) return { query: current.query, filters: current.filters, applied: false };
  const hashed = token.startsWith('#') ? token : `#${token}`;
  const parsed = parseSearchQuery(hashed);
  if (!Object.keys(parsed.filters).length) {
    return { query: current.query, filters: current.filters, applied: false };
  }
  return {
    query: '',
    filters: mergeFilters(current.filters, parsed.filters),
    applied: true,
  };
}

/** 拆出 #标签，剩余当关键词。未知标签仍参与全文搜索。 */
export function parseSearchQuery(raw?: string): ParsedSearchQuery {
  const source = (raw ?? '').trim();
  if (!source) return { text: '', tags: [], filters: {} };

  const tags: string[] = [];
  const filters: FilterState = {};
  const leftover: string[] = [];

  for (const token of source.split(/\s+/).filter(Boolean)) {
    if (!token.startsWith('#') || token.length < 2) {
      leftover.push(token);
      continue;
    }
    const tag = token.slice(1);
    tags.push(tag);
    const mapped = TAG_FILTERS[tag.toLowerCase()] ?? TAG_FILTERS[tag];
    if (!mapped) {
      leftover.push(tag);
      continue;
    }
    if (mapped.key === 'jobTaxonomy' || mapped.key === 'industry' || mapped.key === 'scale' || mapped.key === 'district') {
      const prev = filters[mapped.key];
      const next = Array.isArray(prev) ? prev.filter((item): item is string => typeof item === 'string') : [];
      if (!next.includes(mapped.value)) next.push(mapped.value);
      filters[mapped.key] = next;
    } else {
      filters[mapped.key] = mapped.value;
    }
  }

  return { text: leftover.join(' '), tags, filters };
}

function mergeFilters(base: FilterState | undefined, extra: FilterState): FilterState {
  const next: FilterState = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(extra)) {
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      const prev = next[key];
      const merged = Array.isArray(prev)
        ? prev.filter((item): item is string => typeof item === 'string')
        : [];
      for (const item of value) {
        if (!merged.includes(item)) merged.push(item);
      }
      next[key] = merged;
    } else {
      next[key] = value;
    }
  }
  return next;
}

/** 岗位别名：FE = 前端。Short codes stay token-aware so "be" ≠ Alibaba. */
const JOB_ALIAS_GROUPS: string[][] = [
  ['前端', 'fe', 'frontend', 'front-end'],
  ['后端', 'be', 'backend', 'back-end'],
  ['算法', 'algorithm', 'ml', '机器学习'],
  ['产品', 'pm', 'product'],
  ['设计', 'ui', 'ux', 'designer'],
];

function tokenizeSearch(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s/|+,_-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function aliasGroupForToken(token: string): string[] | undefined {
  return JOB_ALIAS_GROUPS.find((group) => group.some((alias) => alias.toLowerCase() === token));
}

function textHasAliasGroup(haystack: string, group: string[]): boolean {
  const lower = haystack.toLowerCase();
  const tokens = new Set(tokenizeSearch(haystack));
  return group.some((alias) => {
    const key = alias.toLowerCase();
    if (/^[a-z0-9]{1,2}$/.test(key)) return tokens.has(key);
    return lower.includes(key);
  });
}

/** 判断文本是否包含关键词（大小写不敏感，支持多关键词 AND） */
export function matchKeyword(text: string, query: string): boolean {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = text.toLowerCase();
  return terms.every((term) => {
    const group = aliasGroupForToken(term);
    if (group) return textHasAliasGroup(text, group);
    return haystack.includes(term);
  });
}

/** 把行业 code 扩展为可搜索文本（code + 中文标签） */
function industrySearchText(codes: string[]): string {
  return codes
    .map((c) => `${c} ${INDUSTRY_LABELS[c] || ''}`)
    .join(' ');
}

/** 在 POI 的可搜索字段上匹配关键词 */
export function poiMatchesQuery(poi: POI, query: string): boolean {
  if (!query || !query.trim()) return true;

  if (isRecruitmentPOI(poi)) {
    // 公司名 / 行业 / 岗位标题 都参与匹配
    const companyText = [
      poi.company.name,
      industrySearchText(poi.company.industries),
      poi.company.summary || '',
    ].join(' ');
    if (matchKeyword(companyText, query)) return true;
    return poi.positions.some((p) =>
      matchKeyword([p.title, p.department || '', ...(p.skills || [])].join(' '), query)
    );
  }

  // Domain POI：名称 / 分类 / 地址
  return matchKeyword(
    [poi.name, poi.category, poi.subcategory || '', poi.location.address || ''].join(' '),
    query
  );
}

// ---- 筛选 ----

/**
 * 判断单个筛选值是否匹配。
 * 未设置（undefined / 空串 / 空数组）视为不限制。
 */
export function matchFilter(poi: POI, key: string, value: any): boolean {
  if (value === undefined || value === null || value === '') return true;

  switch (key) {
    case 'category': {
      if (!isRecruitmentPOI(poi)) {
        return categoryMatches(poi.category, String(value));
      }
      return true;
    }
    case 'minRating': {
      if (isRecruitmentPOI(poi)) return true;
      const min = Number(value);
      if (!Number.isFinite(min) || min <= 0) return true;
      return (poi.rating ?? 0) >= min;
    }
    case 'price': {
      if (isRecruitmentPOI(poi)) return true;
      if (poi.priceLevel === undefined) return true;
      const range = value as [number, number];
      const mid = poi.priceLevel * 50; // 价格等级 → 估算人均
      return mid >= range[0] && mid <= range[1];
    }
    case 'distance': {
      if (poi.distance === undefined) return true;
      return poi.distance <= (value as number) * 1000;
    }
    case 'openNow': {
      // Domain 模式的"营业中"依赖实时数据，seed 数据无营业状态则忽略
      if (isRecruitmentPOI(poi)) return true;
      return true; // 高德返回 open_time 但无实时状态，Phase 2 放宽
    }
    case 'industry': {
      if (!isRecruitmentPOI(poi)) return true;
      const sel = value as string[];
      if (!sel.length) return true;
      return sel.every((ind) => poi.company.industries.includes(ind));
    }
    case 'scale': {
      if (!isRecruitmentPOI(poi)) return true;
      const sel = value as string[];
      if (!sel.length) return true;
      return sel.includes(poi.company.scale);
    }
    case 'positionType': {
      if (!isRecruitmentPOI(poi)) return true;
      const sel = value as string[];
      if (!sel.length) return true;
      return poi.positions.some((p) => sel.includes(p.type));
    }
    case 'jobTaxonomy': {
      if (!isRecruitmentPOI(poi)) return true;
      const paths = selectedTaxonomyPaths({ [key]: value });
      if (!paths.length) return true;
      return poi.positions.some((p) => positionMatchesTaxonomySelection(p, paths));
    }
    case 'salary': {
      if (!isRecruitmentPOI(poi)) return true;
      const [min, max] = value as [number, number];
      // 公司有任一岗位薪资落在范围内
      return poi.positions.some((p) => {
        if (!p.salary) return false;
        const sal = (p.salary.min + p.salary.max) / 2;
        return sal >= min && sal <= max;
      });
    }
    case 'providesHousing':
    case 'providesShuttle': {
      if (!isRecruitmentPOI(poi)) return true;
      if (!value) return true;
      const keyword = key === 'providesHousing' ? '住宿' : '班车';
      return (poi.benefits || []).some((b) => b.includes(keyword));
    }
    case 'district': {
      const sel = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
      return poiMatchesDistrict(poi, sel);
    }
    default:
      return true;
  }
}

/** 对 POI 列表应用全部筛选条件 */
export function applyFilters(pois: POI[], filters: FilterState): POI[] {
  const entries = Object.entries(filters);
  if (!entries.length) return pois;
  return pois.filter((poi) =>
    entries.every(([key, value]) => matchFilter(poi, key, value))
  );
}

// ---- 排序 ----

/** 获取 POI 的排序分值 */
function sortValue(poi: POI, key: string): number {
  switch (key) {
    case 'distance':
      return poi.distance ?? Number.MAX_SAFE_INTEGER;
    case 'rating':
      if (isRecruitmentPOI(poi)) return poi.company.rating ?? 0;
      return poi.rating ?? 0;
    case 'salaryDesc': {
      if (!isRecruitmentPOI(poi)) return 0;
      const max = poi.positions.reduce((m, p) => Math.max(m, p.salary?.max ?? 0), 0);
      return max;
    }
    case 'positionCount':
      return isRecruitmentPOI(poi) ? poi.positions.length : 0;
    case 'popularity': {
      if (isRecruitmentPOI(poi)) {
        return (poi.positions.length * 30) + Math.round((poi.company.rating ?? 0) * 8);
      }
      return popularityScore(poi);
    }
    case 'qsRank':
      return 0;
    default:
      return 0;
  }
}

/** 排序键 → 方向：true = 降序（大在前） */
const SORT_DESCENDING: Record<string, boolean> = {
  rating: true,
  salaryDesc: true,
  positionCount: true,
  popularity: true,
  qsRank: false,
};

/** 对 POI 列表排序 */
export function sortPOIs(pois: POI[], sortKey: string): POI[] {
  const sorted = [...pois];
  const desc = SORT_DESCENDING[sortKey] ?? false;
  sorted.sort((a, b) => {
    const diff = sortValue(a, sortKey) - sortValue(b, sortKey);
    return desc ? -diff : diff;
  });
  return sorted;
}

// ---- 招聘模式搜索建议（公司 / 岗位，不走高德 POI） ----

export interface RecruitmentSuggestion {
  id: string;
  name: string;
  subtitle: string;
  kind: 'company' | 'job';
  poiId: string;
  positionId?: string;
  location: { lng: number; lat: number };
}

const SCALE_HINT: Record<string, string> = {
  bigtech: '大厂',
  unicorn: '独角兽',
  startup: '创业公司',
  enterprise: '大型企业',
};

/** 从招聘 POI 生成输入建议：公司优先，再补匹配岗位。 */
export function suggestRecruitment(
  pois: POI[],
  query: string,
  limit = 8
): RecruitmentSuggestion[] {
  const q = query.trim();
  if (!q || limit <= 0) return [];

  const companies: RecruitmentSuggestion[] = [];
  const jobs: RecruitmentSuggestion[] = [];

  for (const poi of pois) {
    if (!isRecruitmentPOI(poi)) continue;

    const companyText = [
      poi.company.name,
      industrySearchText(poi.company.industries),
      poi.company.summary || '',
    ].join(' ');
    if (matchKeyword(companyText, q)) {
      companies.push({
        id: `company:${poi.id}`,
        kind: 'company',
        poiId: poi.id,
        name: poi.company.name,
        subtitle: [SCALE_HINT[poi.company.scale], industrySearchText(poi.company.industries).split(' ')[0]]
          .filter(Boolean)
          .join(' · ') || '公司',
        location: { lng: poi.location.lng, lat: poi.location.lat },
      });
    }

    for (const pos of poi.positions) {
      if (pos.status !== 'open') continue;
      const jobText = [pos.title, pos.department || '', ...(pos.skills || []), ...(pos.majors || [])].join(' ');
      if (!matchKeyword(jobText, q)) continue;
      jobs.push({
        id: `job:${pos.id}`,
        kind: 'job',
        poiId: poi.id,
        positionId: pos.id,
        name: pos.title,
        subtitle: [poi.company.name, pos.department].filter(Boolean).join(' · '),
        location: { lng: poi.location.lng, lat: poi.location.lat },
      });
    }
  }

  return [...companies, ...jobs].slice(0, limit);
}

// ---- 组合管线 ----

export interface QueryPipeline {
  query?: string;
  filters?: FilterState;
  sort?: string;
  /** 空间范围（米），0 表示不限 */
  maxDistance?: number;
  /** 参考中心点，用于计算距离 */
  center?: { lng: number; lat: number };
}

/** 完整管线：搜索 → 筛选 → 距离计算 → 排序 */
export function runPOIPipeline(pois: POI[], pipe: QueryPipeline): POI[] {
  let result: POI[] = pois;
  const parsed = parseSearchQuery(pipe.query);

  // 1. 关键词（去掉已识别的 #标签）
  if (parsed.text) {
    result = result.filter((poi) => poiMatchesQuery(poi, parsed.text));
  }

  // 2. 筛选（距离滑块要等算出 distance 后再裁；#标签并入筛选）
  const filters = mergeFilters(pipe.filters, parsed.filters);
  const workingFilters = Object.keys(filters).length ? { ...filters } : undefined;
  const distanceKm =
    workingFilters && typeof workingFilters.distance === 'number' ? workingFilters.distance : undefined;
  if (workingFilters && 'distance' in workingFilters) {
    delete workingFilters.distance;
  }
  if (workingFilters && Object.keys(workingFilters).length) {
    result = applyFilters(result, workingFilters);
  }

  // 3. 距离计算（附加 distance 字段）
  if (pipe.center) {
    result = result.map((poi) => {
      const d = haversine(poi.location, pipe.center!);
      return { ...poi, distance: d };
    });
  }

  // 4. 空间范围（maxDistance 米 或 筛选器 km）
  const maxDistM =
    pipe.maxDistance && pipe.maxDistance > 0
      ? pipe.maxDistance
      : distanceKm !== undefined
        ? distanceKm * 1000
        : 0;
  if (maxDistM > 0) {
    result = result.filter((poi) => (poi.distance ?? Infinity) <= maxDistM);
  }

  // 5. 排序
  if (pipe.sort) {
    result = sortPOIs(result, pipe.sort);
  }

  return result;
}

// 本地 Haversine（避免与 types 循环依赖）
function haversine(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number }
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

// ---- 模式特定的筛选/排序配置（便捷导出） ----

export function getModeFilters(mode: MapMode): FilterConfig[] {
  return getMode(mode).filters;
}

export function getModeSortOptions(mode: MapMode): SortOption[] {
  return getMode(mode).sortOptions;
}
