// ============================================================
// 招聘分类插件 — 工作模式的筛选树
//
// 模式只负责「工作」视角。实习 / 校招 / 社招是 FilterPlugin，
// 挂在 work.filters 上。后续非互联网行业、新工种只需再注册
// 一个 plugin，不要再开新的地图模式。
// ============================================================

import type { FilterConfig, FilterOption, FilterState, JobFamily, Position } from './types.ts';

export interface FilterPlugin {
  id: string;
  label: string;
  /** 英文标签：英文 UI 优先使用,缺失时回退中文 label(见 uiLabel) */
  labelEn?: string;
  /** 产出可挂到 ModeConfig.filters 的配置 */
  filter: FilterConfig;
}

/** 路径：family 或 family/leaf，例如 intern/summer、campus/autumn、social/1-3 */
export type TaxonomyPath = string;

export const JOB_FAMILY_PLUGIN: FilterPlugin = {
  id: 'job-family',
  label: '岗位类型',
  labelEn: 'Job type',
  filter: {
    key: 'jobTaxonomy',
    label: '岗位类型',
    labelEn: 'Job type',
    type: 'taxonomy',
    options: [
      {
        value: 'intern',
        label: '实习',
        labelEn: 'Intern',
        children: [
          { value: 'intern/summer', label: '暑期实习', labelEn: 'Summer intern' },
          { value: 'intern/daily', label: '日常实习', labelEn: 'Daily intern' },
          { value: 'intern/conversion', label: '有转正', labelEn: 'Conversion' },
          { value: 'intern/no-conversion', label: '无转正', labelEn: 'No conversion' },
        ],
      },
      {
        value: 'campus',
        label: '校招',
        labelEn: 'Campus',
        children: [
          { value: 'campus/autumn', label: '秋招', labelEn: 'Autumn' },
          { value: 'campus/spring', label: '春招', labelEn: 'Spring' },
        ],
      },
      {
        value: 'social',
        label: '社招',
        labelEn: 'Full-time',
        children: [
          { value: 'social/0-1', label: '0–1 年', labelEn: '0–1 yr' },
          { value: 'social/1-3', label: '1–3 年', labelEn: '1–3 yr' },
          { value: 'social/3-5', label: '3–5 年', labelEn: '3–5 yr' },
          { value: 'social/5+', label: '5 年+', labelEn: '5+ yr' },
        ],
      },
    ],
  },
};

/** 职能（技术/产品/运营/设计）。与 intern/campus/social 的岗位类型树分开。 */
export const ROLE_OPTIONS: FilterOption[] = [
  { value: 'tech', label: '技术', labelEn: 'Tech' },
  { value: 'product', label: '产品', labelEn: 'Product' },
  { value: 'ops', label: '运营', labelEn: 'Operations' },
  { value: 'design', label: '设计', labelEn: 'Design' },
];

export const ROLE_FAMILY_PLUGIN: FilterPlugin = {
  id: 'role-family',
  label: '职能',
  labelEn: 'Role',
  filter: {
    key: 'roleFamily',
    label: '职能',
    labelEn: 'Role',
    type: 'multi-select',
    options: ROLE_OPTIONS,
  },
};

/** 工作模式默认挂上的筛选插件。新行业 / 职能在此追加即可。 */
export const WORK_FILTER_PLUGINS: FilterPlugin[] = [JOB_FAMILY_PLUGIN, ROLE_FAMILY_PLUGIN];

function roleHaystack(position: Position): string {
  return `${position.title} ${position.department ?? ''} ${(position.skills ?? []).join(' ')}`;
}

/** 岗位标题/部门/技能是否落在某个职能桶。产品运营算运营，芯片设计算技术。 */
export function positionMatchesRole(position: Position, role: string): boolean {
  const hay = roleHaystack(position);
  if (role === 'ops') return /运营/.test(hay);
  if (role === 'product') return /产品/.test(hay) && !/运营/.test(hay);
  if (role === 'design') return /(视觉|设计师|UI|UX)/i.test(hay) && !/芯片/.test(hay);
  if (role === 'tech') {
    return /(前端|后端|算法|开发|工程|Java|Android|iOS|SLAM|NLP|Infra|芯片|嵌入式|SRE|测试|数据)/i.test(hay)
      && !/运营/.test(hay)
      && !/产品经理/.test(hay);
  }
  return false;
}

export function selectedRoleFamilies(filters: FilterState): string[] {
  const raw = filters.roleFamily;
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string');
  if (typeof raw === 'string' && raw) return [raw];
  return [];
}

export function workFilterConfigs(): FilterConfig[] {
  return WORK_FILTER_PLUGINS.map((plugin) => plugin.filter);
}

export function parseTaxonomyPath(path: TaxonomyPath): {
  family: JobFamily;
  leaf?: string;
} | null {
  if (!path) return null;
  const [family, leaf] = path.split('/');
  if (family !== 'intern' && family !== 'campus' && family !== 'social') return null;
  return { family, leaf };
}

/** 岗位是否命中一条 taxonomy 路径 */
export function positionMatchesTaxonomy(position: Position, path: TaxonomyPath): boolean {
  const parsed = parseTaxonomyPath(path);
  if (!parsed) return true;
  const tax = position.taxonomy ?? { family: position.type };
  if (tax.family !== parsed.family) return false;
  if (!parsed.leaf) return true;
  if (parsed.family === 'intern') {
    return tax.internKind === parsed.leaf || tax.conversion === parsed.leaf;
  }
  if (parsed.family === 'campus') {
    return tax.campusSeason === parsed.leaf;
  }
  return tax.experience === parsed.leaf;
}

export function selectedTaxonomyPaths(filters: FilterState): TaxonomyPath[] {
  const raw = filters.jobTaxonomy;
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  if (typeof raw === 'string' && raw) return [raw];
  return [];
}

/**
 * 公司是否命中当前筛选树。
 * 家庭之间是 OR；同一家庭若勾了叶子，只看叶子（父级只负责展开 UI）。
 */
export function positionMatchesTaxonomySelection(
  position: Position,
  paths: TaxonomyPath[],
): boolean {
  if (!paths.length) return true;
  const leavesByFamily = new Map<JobFamily, TaxonomyPath[]>();
  const families = new Set<JobFamily>();
  for (const path of paths) {
    const parsed = parseTaxonomyPath(path);
    if (!parsed) continue;
    families.add(parsed.family);
    if (parsed.leaf) {
      const list = leavesByFamily.get(parsed.family) ?? [];
      list.push(path);
      leavesByFamily.set(parsed.family, list);
    }
  }
  if (!families.size) return true;
  for (const family of families) {
    const leaves = leavesByFamily.get(family);
    if (leaves?.length) {
      if (leaves.some((path) => positionMatchesTaxonomy(position, path))) return true;
    } else if (positionMatchesTaxonomy(position, family)) {
      return true;
    }
  }
  return false;
}

export function flattenTaxonomyOptions(options: FilterOption[] = []): FilterOption[] {
  const out: FilterOption[] = [];
  for (const option of options) {
    out.push(option);
    if (option.children?.length) out.push(...flattenTaxonomyOptions(option.children));
  }
  return out;
}

/** 给旧 seed 补默认细分，避免筛选树全空 */
export function defaultTaxonomyForType(type: JobFamily): Position['taxonomy'] {
  if (type === 'intern') {
    return { family: 'intern', internKind: 'daily', conversion: 'no-conversion' };
  }
  if (type === 'campus') {
    return { family: 'campus', campusSeason: 'autumn' };
  }
  return { family: 'social', experience: '1-3' };
}
