// extract-embodied-jobs.mjs 解析器单测。
// fixture 是快照 (Octoday-Hub/Embodied-AI topics/02-jobs.md, 2026-08-21) 结构
// 的忠实小样: 导航表(2 格) / tbody 内 th 表头行 / colspan=5 锚点行 / rowspan
// 公司组 / 单岗公司 / 空类型兜底 / 海外英文标签 — 与真实快照逐项对齐。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  familyForType,
  matchCompany,
  parseCompanies,
  parseTableRows,
  unionCities,
} from '../scripts/extract-embodied-jobs.mjs';

const FIXTURE = `# 岗位与计划总览

<table style="width: 100%; border-collapse: collapse;">
  <tr>
    <td style="padding: 10px 12px; border: 1px solid #ddd; font-weight: bold;">链接直达:</td>
    <td style="padding: 10px 12px; border: 1px solid #ddd; text-align: center;">
      <a href="#jump-jobs-domestic-e1">A</a><a href="#jump-jobs-domestic-b1">B</a>
    </td>
  </tr>
</table>

<table>
<thead>
<tr>
<th>公司</th>
<th>岗位</th>
<th>类型</th>
<th>地点</th>
<th>投递</th>
</tr>
</thead>
<tbody>

<tr>
<td colspan="5" style="padding: 0; border: 0; height: 0;"><a id="jump-jobs-domestic-e1" name="jump-jobs-domestic-e1"></a></td>
</tr>
<tr>
<td rowspan="3"><strong>埃斯顿</strong></td>
<td>自动化工程师</td>
<td>社招</td>
<td>南京市</td>
<td><div align="center"><a href="https://estun1.zhiye.com/social/detail?jobAdId=aaa"><img src="../files/deliver-button.svg" alt="投递" width="92" height="38" /></a></div></td>
</tr>
<tr>
<td>机器人应用软件工程师</td>
<td>校招</td>
<td>南京市</td>
<td><div align="center"><a href="https://estun1.zhiye.com/campus/detail?jobAdId=bbb"><img src="../files/deliver-button.svg" alt="投递" width="92" height="38" /></a></div></td>
</tr>
<tr>
<td>伺服算法实习生</td>
<td>实习</td>
<td>南京市</td>
<td><div align="center"><a href="https://estun1.zhiye.com/intern/detail?jobAdId=ccc"><img src="../files/deliver-button.svg" alt="投递" width="92" height="38" /></a></div></td>
</tr>
<tr>
<td colspan="5" style="padding: 0; border: 0; height: 0;"><a id="jump-jobs-domestic-e2"></a></td>
</tr>
<tr>
<td><strong>安徽合力</strong></td>
<td>机器人算法工程师</td>
<td>社招</td>
<td>合肥市</td>
<td><div align="center"><a href="https://example.com/helijob"><img src="../files/deliver-button.svg" alt="投递" width="92" height="38" /></a></div></td>
</tr>
<tr>
<td colspan="5" style="padding: 0; border: 0; height: 0;"><a id="jump-jobs-domestic-q1"></a></td>
</tr>
<tr>
<td rowspan="2"><strong>千寻智能</strong></td>
<td>具身模型推理&amp;部署工程师</td>
<td>未标注</td>
<td>北京市</td>
<td><div align="center"><a href="https://example.com/qx1"><img src="../files/deliver-button.svg" alt="投递" width="92" height="38" /></a></div></td>
</tr>
<tr>
<td>具身模型算法工程师（预训练）</td>
<td>未标注</td>
<td>北京市</td>
<td><div align="center"><a href="mailto:hr@example.com"><img src="../files/deliver-button.svg" alt="投递" width="92" height="38" /></a></div></td>
</tr>
<tr>
<td colspan="5" style="padding: 0; border: 0; height: 0;"><a id="jump-jobs-domestic-x1"></a></td>
</tr>
<tr>
<td rowspan="2"><strong>星动纪元</strong></td>
<td>具身智能暑期实习生</td>
<td>专项</td>
<td>北京市/上海市</td>
<td><div align="center"><a href="https://example.com/xdj1"><img src="../files/deliver-button.svg" alt="投递" width="92" height="38" /></a></div></td>
</tr>
<tr>
<td>具身大模型算法工程师</td>
<td>专项</td>
<td>北京市、上海市</td>
<td><div align="center"><a href="https://example.com/xdj2"><img src="../files/deliver-button.svg" alt="投递" width="92" height="38" /></a></div></td>
</tr>
<tr>
<td colspan="5" style="padding: 0; border: 0; height: 0;"><a id="jump-jobs-overseas-n1"></a></td>
</tr>
<tr>
<td rowspan="3"><strong>NVIDIA</strong></td>
<td>Software Engineer, Simulation - Robotics</td>
<td>Full-time</td>
<td>Santa Clara, CA</td>
<td><div align="center"><a href="https://nvidia.wd5.myworkdayjobs.com/job/Simulation_JR2015217"><img src="../files/deliver-button.svg" alt="投递" width="92" height="38" /></a></div></td>
</tr>
<tr>
<td>New Grad - Robot Learning</td>
<td>New Grad</td>
<td>Sunnyvale, CA / Seattle, WA</td>
<td><div align="center"><a href="https://nvidia.wd5.myworkdayjobs.com/job/NewGrad_JR2013413"><img src="../files/deliver-button.svg" alt="投递" width="92" height="38" /></a></div></td>
</tr>
<tr>
<td>PhD Fellowship</td>
<td>Postdoc</td>
<td>美国/全球</td>
<td><div align="center"><a href="https://nvidia.wd5.myworkdayjobs.com/job/Fellowship_JR2017288"><img src="../files/deliver-button.svg" alt="投递" width="92" height="38" /></a></div></td>
</tr>
</tbody>
</table>
`;

test('parseCompanies 忠实解析 rowspan 公司组, 跳过导航/th/锚点行', () => {
  const rows = parseTableRows(FIXTURE);
  const { companies, orphanRows } = parseCompanies(rows);
  assert.equal(orphanRows, 0);
  assert.deepEqual(
    companies.map((c) => [c.name, c.jobs.length]),
    [
      ['埃斯顿', 3],
      ['安徽合力', 1],
      ['千寻智能', 2],
      ['星动纪元', 2],
      ['NVIDIA', 3],
    ],
  );

  // 埃斯顿: 岗位/类型/地点/链接 逐项
  const estun = companies[0];
  assert.equal(estun.jobs[0].title, '自动化工程师');
  assert.equal(estun.jobs[0].typeText, '社招');
  assert.equal(estun.jobs[0].cityText, '南京市');
  assert.equal(estun.jobs[0].href, 'https://estun1.zhiye.com/social/detail?jobAdId=aaa');
  // 按钮图 img src 不是链接; 实体 &amp; 已解码
  assert.equal(estun.jobs[0].href.includes('deliver-button'), false);

  // 单岗公司 (5 格无 rowspan) 也算 1 岗
  assert.equal(companies[1].name, '安徽合力');
  assert.equal(companies[1].jobs[0].title, '机器人算法工程师');
});

test('行无 http 链接 → href null (由主流程用公司首个有效链接兜底)', () => {
  const { companies } = parseCompanies(parseTableRows(FIXTURE));
  const qianxun = companies.find((c) => c.name === '千寻智能');
  assert.equal(qianxun.jobs[0].href, 'https://example.com/qx1');
  assert.equal(qianxun.jobs[1].href, null); // mailto: 非 http(s)
  assert.equal(qianxun.jobs[1].title, '具身模型算法工程师（预训练）');
});

test('familyForType 直映 + 关键词推断 + social 兜底 (2026-08-21 决策表)', () => {
  // 直接映射
  assert.equal(familyForType('社招'), 'social');
  assert.equal(familyForType('校招'), 'campus');
  assert.equal(familyForType('实习'), 'intern');
  assert.equal(familyForType('校招/实习'), 'campus'); // 多标签校招优先
  assert.equal(familyForType('Full-time'), 'social');
  assert.equal(familyForType('Permanent/Contract'), 'social');
  assert.equal(familyForType('New Grad'), 'campus');
  assert.equal(familyForType('Internship'), 'intern');
  assert.equal(familyForType('Internship/Co-op'), 'intern');
  // 未标注/专项/空 → 岗位名关键词推断
  assert.equal(familyForType('未标注', '具身智能暑期实习生'), 'intern');
  assert.equal(familyForType('未标注', '算法实习生（强化学习方向）'), 'intern');
  assert.equal(familyForType('专项', '顶尖应届-具身大模型算法工程师'), 'campus');
  assert.equal(familyForType('专项', 'Amazon Robotics - PhD Internship'), 'intern');
  assert.equal(familyForType('专项', 'Algorithm Engineer - Intern'), 'intern');
  assert.equal(familyForType('专项', '26届AI领航员-结构设计工程师'), 'social'); // 届 不在推断关键词内 → 兜底 (2026-08-21 记录)
  // 兜底
  assert.equal(familyForType('未标注', '具身模型推理&部署工程师'), 'social');
  assert.equal(familyForType('', '云深处科技算法工程师'), 'social');
  assert.equal(familyForType('Postdoc', 'PhD Fellowship'), 'social');
});

test('unionCities 去重并集 (中英文分隔符差异)', () => {
  assert.equal(unionCities(['南京市']), '南京市');
  assert.equal(unionCities(['北京市/上海市']), '北京市 上海市');
  assert.equal(unionCities(['北京市、上海市', '北京市']), '北京市 上海市');
  assert.equal(unionCities(['上海市,芜湖市']), '上海市 芜湖市');
  assert.equal(unionCities(['深圳市/上海市', '深圳市,南京市']), '深圳市 上海市 南京市');
  // 含 ASCII 的城市串不按逗号拆 (San Jose, CA 是城市名内部逗号)
  assert.equal(unionCities(['San Jose, CA']), 'San Jose, CA');
  assert.equal(unionCities(['Sunnyvale, CA / London, UK']), 'Sunnyvale, CA London, UK');
  assert.equal(unionCities(['美国/全球']), '美国 全球');
  assert.equal(unionCities(['北美', '北美']), '北美');
  assert.equal(unionCities(['北京市/上海市', 'Sunnyvale, CA']), '北京市 上海市 Sunnyvale, CA');
});

test('matchCompany: 精确 → 唯一前缀别名 → ambiguous → none', () => {
  const existing = new Map([
    ['九号公司', { dir: 'radar', file: '九号公司.json', data: { name: '九号公司' } }],
    ['荣耀HONOR', { dir: 'radar', file: '荣耀honor.json', data: { name: '荣耀HONOR' } }],
    ['柏楚电子', { dir: 'radar', file: '柏楚电子.json', data: { name: '柏楚电子' } }],
    ['柏楚电子-热招', { dir: 'radar', file: '柏楚电子-热招.json', data: { name: '柏楚电子-热招' } }],
    ['埃斯顿', { dir: 'qqdoc-jobs', file: 'qqj-埃斯顿.json', data: { name: '埃斯顿' } }],
  ]);
  assert.equal(matchCompany('九号', existing).kind, 'alias');
  assert.equal(matchCompany('九号', existing).matchedName, '九号公司');
  assert.equal(matchCompany('荣耀', existing).kind, 'alias');
  assert.equal(matchCompany('埃斯顿', existing).kind, 'exact');
  // 多候选 → ambiguous (不强行匹配)
  assert.equal(matchCompany('柏楚', existing).kind, 'ambiguous');
  assert.deepEqual(matchCompany('柏楚', existing).candidates.sort(), ['柏楚电子', '柏楚电子-热招']);
  // 未命中 → none
  assert.equal(matchCompany('极佳', existing).kind, 'none');
});
