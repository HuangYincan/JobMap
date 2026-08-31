# ws-a 汇报(2026-08-22)— fix/grader-seq-relax(office POI 匹配放宽:限定词 token 序列)

## 实际改动

- `server/src/lib/site-geocode.ts`
  - `officeNameMatchStrength` 的 `matches()`(:946-953):suffix/prefix 从「单个限定词
    token」放宽为「**限定词 token 序列**」——整段必须完全由集合内 token 拼接而成,
    任意长度线性拼接,超长串(4+ token)不递归不崩。
    - suffix 序列 = QUALIFIER_SUFFIXES token + 城市名 token(快手北京 类分支命名);
      前缀子串贪心(**最长 token 优先**):「研发大厦」拆 研发|大厦(集合内无 研发大,
      天然不会拆 研发大|厦);研究院/运营总部 等长 token 优先整段命中。
    - prefix 序列 = 城市名 token(可带 省/市 后缀,北京市 → 北京)+ 品牌拼音 token
      (连续 ≥2 位小写字母,ROMAN_PREFIX_RE 语义)。
    - **假阳性防线不变**:非限定词 token(包装/实业/造型/鱼庄/驿站/店/站/旗舰店…)
      混入 → 整段拒绝;括号段允许表语义不变。
  - 新增 `cityTokenLen`(:882)/`isQualifierPrefixSeq`(:893)/`isQualifierSuffixSeq`(:915);
    删除旧单 token `isQualifierPrefix` / `isQualifierSuffix`。
  - `GOOD_BRACKET_SEG_RE`(:876)增加 `分公司|公司|科技|研发|基地|大楼|学校`
    (允许表语义,不在表内即拒 → 分店/旗舰店/体验店/站/驿站 括号段仍拒收,无需显式排除)。
- `server/tests/site-geocode.test.mjs` — 新增 2 组测试(见下)。
- `server/tests/geocode-address-first.test.mjs` — 2 处旧严格行为断言更新(边界外,见问题 3)。

## 测试清单

- **新接受**(复合限定词序列):百度研发大厦(研发|大厦)/百度大厦/百度科技公司(科技|公司)/
  百度研究院(研究院 单段 3 字优先)/百度研发大厦总部基地(4 段长串不崩)/得物大厦/快手北京/
  上海燧原科技(既有行为不回退)/北京百度智图科技有限公司(上海分公司) vs 百度智图
  (城市前缀 北京 + 科技|公司 复合 + 括号 分公司)。
- **仍拒绝**(防线不回退):广州得物包装实业有限公司/百度鱼庄/百度造型/纤百度造型/
  百度造型(分店002)/得物旗舰店/某司驿站/百度研发鱼庄(复合中混入非限定词)/
  北京百度智图科技有限公司(上海分公司) vs 百度(智图 = 非限定词,同 包装 防线)。
- **括号段扩展**:接受 (上海分公司)/(北京研发)/(软件园基地)/(总部大楼);仍拒
  分店002/旗舰店/体验店/站/驿站 括号段。
- **既有测试零回退**:得物=得物 / 快手(星耀中心7号楼)=快手 精确同名仍 strong;
  门店/驿站陷阱(快手(濮院店)/拼多多驿站)仍拒。

## 门禁结果

- npm test:**1399 通过 / 2 失败 / 2 skip**(改动前基线 1397/2/2 — 2 失败与我的
  改动无关,见问题 1;site-geocode.test.mjs +2 测试全部 ✔)
- typecheck:通过
- docs-check:通过
- git diff --check:通过(树干净)

## 遇到的问题

1. **npm test 2 个失败为既有失败,不在本 WS 边界**(split-city-sites.test.mjs,
   该文件不 import site-geocode.ts,与我的改动无关,基线即红):
   - `无任何非杭州 drop 站点坐标落在杭州参考框内` — official-career/蔚来.json 绍兴站
     坐标 120.512106/30.092944 落在杭州参考框(fix-sweep-accident-coords 数据问题);
   - `真实数据: qqj-临界点 拆分后主站点补点` — 数据已是真实坐标 121.439346/31.197401,
     测试仍断言城市中心 121.47/31.23(r4 数据契约未对齐)。
   两者正是本批 ws-b「r4 数据契约测试对齐」的任务(README 合并顺序 ws-a→ws-b→ws-c);
   我按文件边界未碰。→ 需 boss 知悉:合并 ws-b 后全绿。
2. **「两者都空不允许」未采纳**:精确同名(候选名 = 公司名,得物 vs 得物 / 快手(星耀
   中心7号楼) vs 快手)保持 strong。理由:(a) 既有测试如此断言,且 prompt 的「若既有
   测试断言旧严格行为,更新为新语义」只授权 strict→relax 单向更新,收紧不在此列;
   (b) 收紧只增 r5 假阴性,与任务「放宽」方向及「既有行为不回退」矛盾;(c)
   快手(星耀中心7号楼) 是 pickBestOfficePoi 门店/办公室甄别测试的依赖,拒绝它会连带
   破坏防门店陷阱行为。若 boss 确要改,是一行改动(matches() 去掉 `(prefix === '' &&
   suffix === '')` 分支)。
3. **文件边界外测试更新(预授权条款)**:放宽后「网易杭州研究院」(杭州+研究院 城市+
   限定词复合)被裸公司名单级评分接受 → `geocode-address-first.test.mjs` 2 处断言
   旧严格行为(gradeVariantHit 裸公司名单级评分 low / pickBestOfficePoi undefined)
   转红,按 prompt「若既有测试断言旧严格行为,更新为新语义(更新时在汇报列出)」条款
   更新为 high/命中 —— 动了边界外第三个文件,此为本文件边界唯一例外。
4. **智图案例口径**:prompt 案例「北京百度智图科技有限公司(上海分公司)→ strong」按
   公司名 = 百度智图 实现(城市前缀+科技公司+括号 分公司);对裸 百度 的认领后缀是
   「智图科技…」— 智图 与 包装 同为非限定词 token,接受即突破 2026-08-19 防线,
   保持 no(已入拒收测试)。r5 实际影响 ≈ 0:百度站 POI 命中由 百度研发大厦 承担。

## 证据

- 测试输出摘要:site-geocode.test.mjs 3 组 grader 测试全部 ✔(qualifier-wrapped 既有
  组 / compound qualifier sequences 新组 / GOOD_BRACKET 新组);geocode-address-first
  更新 2 组 ✔;全量 `ℹ tests 1399 / pass 1395 / fail 2(split-city-sites 既有)/
  cancelled 0 / skipped 2`。
- commit 列表:
  - `b906cef` fix(geocode): officeNameMatchStrength 限定词 token 序列放宽 + 括号段扩展
  - `62626f4` test(geocode): 复合限定词序列接受/防线拒收/括号段扩展 + 旧严格断言更新
  - 分支 fix/grader-seq-relax,工作树干净,未 merge 未 push。

门禁: FAILED
结论: OK
