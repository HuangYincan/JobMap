// i18n 地基(WS w1):uiLabel 渲染辅助 + 选项/筛选全量 labelEn 完整性。
// 目标:英文 UI 下 default map 选项、industries、filter 卡片、排序下拉不漏中文。
import test from 'node:test';
import assert from 'node:assert/strict';

import { t, uiLabel } from '../src/lib/i18n.ts';
import { INDUSTRY_OPTIONS, MODES } from '../src/lib/modes.ts';
import {
  JOB_FAMILY_PLUGIN,
  ROLE_FAMILY_PLUGIN,
  ROLE_OPTIONS,
  flattenTaxonomyOptions,
} from '../src/lib/job-taxonomy.ts';

const CJK = /[一-鿿]/;

/** 收集所有带 label 的对象(含 options/children 递归) */
function collectLabeled(items, out = []) {
  for (const item of items ?? []) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.label === 'string') {
      out.push(item);
      collectLabeled(item.options, out);
      collectLabeled(item.children, out);
    }
  }
  return out;
}

test('uiLabel: zh 恒用 label,en 优先 labelEn,en 缺 labelEn 回退 label', () => {
  const o = { label: '距离', labelEn: 'Distance' };
  assert.equal(uiLabel(o, 'zh'), '距离');
  assert.equal(uiLabel(o, 'en'), 'Distance');
  assert.equal(uiLabel({ label: 'C9' }, 'en'), 'C9', 'en 且无 labelEn → 回退中文 label');
  assert.equal(uiLabel({ label: 'C9' }, 'zh'), 'C9');
});

test('uiLabel: 与 t() 同源,不破坏既有翻译', () => {
  assert.equal(t('search', 'zh'), '搜索');
  assert.equal(t('search', 'en'), 'Search');
  assert.equal(uiLabel({ label: '距离', labelEn: 'Distance' }, 'en'), 'Distance');
});

test('INDUSTRY_OPTIONS: 每个选项都带 labelEn,且与翻译表一致', () => {
  assert.equal(INDUSTRY_OPTIONS.length, 10);
  for (const o of INDUSTRY_OPTIONS) {
    assert.ok(typeof o.labelEn === 'string' && o.labelEn.length > 0, `${o.label} 缺 labelEn`);
  }
  const byValue = Object.fromEntries(INDUSTRY_OPTIONS.map((o) => [o.value, o.labelEn]));
  assert.equal(byValue.finance, 'Finance');
  assert.equal(byValue.ai, 'AI');
  assert.equal(byValue.ecommerce, 'E-commerce');
  assert.equal(byValue.consumer, 'Consumer');
});

test('MODES 完整性:所有中文 label/unit/searchPlaceholder 均有英文对应', () => {
  const modes = ['domain', 'work', 'college', 'overseas'];
  for (const id of modes) {
    const mode = MODES[id];
    // 搜索占位符
    if (CJK.test(mode.searchPlaceholder)) {
      assert.ok(
        typeof mode.searchPlaceholderEn === 'string' && mode.searchPlaceholderEn.length > 0,
        `${id}.searchPlaceholder 缺 searchPlaceholderEn`,
      );
    }
    // 筛选器 + 选项(含 taxonomy 树 children)
    const labeled = collectLabeled(mode.filters);
    for (const item of labeled) {
      assert.ok(
        !CJK.test(item.label) || (typeof item.labelEn === 'string' && item.labelEn.length > 0),
        `${id} 筛选/选项「${item.label}」缺 labelEn`,
      );
      if (CJK.test(item.unit ?? '')) {
        assert.ok(
          typeof item.unitEn === 'string' && item.unitEn.length > 0,
          `${id} 筛选「${item.label}」单位「${item.unit}」缺 unitEn`,
        );
      }
    }
    // 排序选项
    for (const s of mode.sortOptions ?? []) {
      assert.ok(
        !CJK.test(s.label) || (typeof s.labelEn === 'string' && s.labelEn.length > 0),
        `${id} 排序「${s.label}」缺 labelEn`,
      );
    }
  }
});

test('MODES 抽查:关键翻译与表一致', () => {
  const domain = MODES.domain;
  const work = MODES.work;
  const college = MODES.college;
  const overseas = MODES.overseas;
  assert.equal(domain.searchPlaceholderEn, 'Search places or addresses');
  assert.equal(work.searchPlaceholderEn, 'Search companies or jobs');
  assert.equal(college.searchPlaceholderEn, 'Search schools and majors…');
  assert.equal(overseas.searchPlaceholderEn, 'Search schools and programs…');

  const domainSorts = Object.fromEntries(domain.sortOptions.map((s) => [s.key, s.labelEn]));
  assert.equal(domainSorts.priceAsc, 'Price: low to high');
  assert.equal(domainSorts.priceDesc, 'Price: high to low');

  const byKey = (filters, key) => filters.find((f) => f.key === key);
  assert.equal(byKey(domain.filters, 'category').labelEn, 'Category');
  assert.equal(byKey(domain.filters, 'minRating').unitEn, 'pts');
  assert.equal(byKey(domain.filters, 'price').unitEn, '¥');
  assert.equal(byKey(work.filters, 'salary').unitEn, 'K/mo');
  assert.equal(byKey(work.filters, 'onlyOpen').labelEn, 'Open roles only');
  assert.equal(byKey(college.filters, 'level').labelEn, 'Level');
  assert.equal(byKey(overseas.filters, 'country').labelEn, 'Country / region');
  assert.equal(byKey(work.filters, 'distance').labelEn, 'Distance');
  assert.equal(byKey(work.filters, 'distance').unitEn, undefined, 'km 不翻');

  const overseasCountries = byKey(overseas.filters, 'country').options;
  const byValue = Object.fromEntries(overseasCountries.map((o) => [o.value, o.labelEn]));
  assert.equal(byValue.us, 'United States');
  assert.equal(byValue.uk, 'United Kingdom');
  assert.equal(byValue.hk, 'Hong Kong');
});

test('job-taxonomy:岗位类型树 + 职能全量 labelEn,与 i18n.ts 既有条目一致', () => {
  const all = [
    ...collectLabeled([JOB_FAMILY_PLUGIN, ROLE_FAMILY_PLUGIN]),
    ...flattenTaxonomyOptions(ROLE_OPTIONS),
    ...collectLabeled([JOB_FAMILY_PLUGIN.filter, ROLE_FAMILY_PLUGIN.filter]),
  ];
  for (const item of all) {
    assert.ok(
      !CJK.test(item.label) || (typeof item.labelEn === 'string' && item.labelEn.length > 0),
      `job-taxonomy「${item.label}」缺 labelEn`,
    );
  }
  // 插件自身 label 与 filter.label 都要翻
  assert.equal(JOB_FAMILY_PLUGIN.labelEn, 'Job type');
  assert.equal(ROLE_FAMILY_PLUGIN.labelEn, 'Role');
  assert.equal(JOB_FAMILY_PLUGIN.filter.labelEn, 'Job type');
  assert.equal(ROLE_FAMILY_PLUGIN.filter.labelEn, 'Role');

  const leafByPath = Object.fromEntries(
    flattenTaxonomyOptions(JOB_FAMILY_PLUGIN.filter.options).map((o) => [o.value, o.labelEn]),
  );
  assert.equal(leafByPath['intern'], 'Intern');
  assert.equal(leafByPath['intern/summer'], 'Summer intern');
  assert.equal(leafByPath['intern/no-conversion'], 'No conversion');
  assert.equal(leafByPath['campus/autumn'], 'Autumn');
  assert.equal(leafByPath['social/1-3'], '1–3 yr');
  assert.equal(leafByPath['social/5+'], '5+ yr');

  const roleByValue = Object.fromEntries(ROLE_OPTIONS.map((o) => [o.value, o.labelEn]));
  assert.equal(roleByValue.tech, 'Tech');
  assert.equal(roleByValue.ops, 'Operations');
  assert.equal(roleByValue.design, 'Design');
});
