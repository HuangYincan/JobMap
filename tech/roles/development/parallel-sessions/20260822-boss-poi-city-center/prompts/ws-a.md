# Workstream ws-a — fix/grader-seq-relax(office POI 匹配放宽:限定词 token 序列)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree 内开发,不 merge、不 push、不碰主树。**
汇报写入批次目录 reports/ws-a.md(末两行 token,见文末)。

## 背景(2026-08-22 实测)

「大量 POI 位于城市中心」bug 根因之二:geocode r4 只修 288 站,r5(待重跑 1092 站的公司名
检索)未执行。r5 的**前置代码缺口**:941 站地址是多城市占位串(「北京/上海/深圳/成都」),
走公司名 place-search 分支,但 **831 站 no-result**。活体诊断(真实 key,上海,query=百度)证明根因:

```
POI: 百度研发大厦 | 上海市浦东新区纳贤路百度上海研发中心 => low name-mismatch:百度研发大厦
POI: 北京百度智图科技有限公司(上海分公司) => low name-mismatch
```

**真实办公室 POI 存在,但 `officeNameMatchStrength` 的「公司名 + 单个限定词 token」
规则拒了复合限定词**:suffix=「研发大厦」是 研发+大厦 两个 token,matches() 只认整段
在 QUALIFIER_SUFFIXES 集合内 → 'no'。2026-08-19 该规则为防假阳性(得物 ⊂ 广州得物包装
实业有限公司 不匹配;门店/驿站陷阱)而设——放宽时**必须保留这些防线**。

## 任务(只改 `server/src/lib/site-geocode.ts` + `server/tests/site-geocode.test.mjs`)

1. **`officeNameMatchStrength` 的 `matches()`**:suffix/prefix 从「单个限定词 token」
   放宽为「**限定词 token 序列**」(集合内 token 可拼接,需整段完全由集合 token 组成)。
   - QUALIFIER_SUFFIXES 的 token 拼接:如 研发+大厦 → 研发大厦;科技+公司 → 科技公司;
     大楼+中心、园区+基地… 任意长度序列(实测最长 3-4 段,线性拼接即可,注意
     前缀子串贪心:先匹配集合内最长 token,再试短 token——「研发大厦」应拆 研发|大厦
     而非 研发大|厦)。
   - prefix 组合同理(CITY_PREFIXES / ROMAN_PREFIX_RE 的 token 序列),但保持「城市
     前缀 + 限定词后缀」的既有结构要求:组合前后缀仍须至少各占一边(空 prefix 时
     suffix 必须非空且全限定词,反之亦然;两者都空不允许)。
   - **假阳性防线不变**:非限定词 token(包装/实业/造型/鱼庄/驿站/店/站/旗舰店…)
     混入 → 整段拒绝;括号段规则(GOOD_BRACKET_SEG_RE)保留并扩展(见 2)。
   - 参考已给案例手动核对:百度研发大厦 → strong;北京百度智图科技有限公司(上海分公司)
     → strong(城市前缀+科技公司+括号 分公司);广州得物包装实业有限公司 → no;
     百度鱼庄 / 百度造型 / 纤百度造型 → no。
2. **`GOOD_BRACKET_SEG_RE`**:增加 分公司/公司/科技/研发/基地/大楼/学校(保持 店|站|
   驿站 拒收语义——GOOD_BRACKET_SEG_RE 是「允许」表,不在表内即拒,所以不需要
   显式排除,但**新增测试**覆盖 分店/旗舰店/体验店 括号段仍被拒)。
3. **测试**(`server/tests/site-geocode.test.mjs`,对齐现有风格):
   - 新接受:百度研发大厦/百度大厦/北京百度智图科技有限公司(上海分公司)/得物大厦/
     快手北京/上海燧原科技(既有行为不回退)。
   - 仍拒绝:广州得物包装实业有限公司/百度鱼庄/百度造型/纤百度造型/百度造型(分店002)/
     得物旗舰店/某司驿站。
   - 复合拆分的边界:研发大厦 拆 研发|大厦(不是 研发大|厦);科技公司 拆 科技|公司;
     超长串(4+ token)不崩。
   - 若既有测试断言旧严格行为,更新为新语义(更新时在汇报列出)。

## 文件边界

- 只改:`server/src/lib/site-geocode.ts`、`server/tests/site-geocode.test.mjs`
- 不碰:数据文件(server/data/recruitment/**)、其他脚本、前端、文档

## 门禁(全部通过才算 OK)

```bash
cd /Users/acccan/dm-wt-pcc-a/server && npm test
cd /Users/acccan/dm-wt-pcc-a/server && npm run typecheck
cd /Users/acccan/dm-wt-pcc-a && make docs-check
git diff --check
```

参考基线(主树 2026-08-22 实测,worker 以自己实测为准):全量测试 1361+ pass / 0 fail / 2 skip 量级。
测试若因你的改动变化,汇报里给「改动前 vs 改动后」数字。频繁小步 commit(Conventional
Commits: `fix(geocode): …` / `test(geocode): …`)。

## 回报(写入 /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-poi-city-center/reports/ws-a.md)

- 改了什么(file:line 摘要 + 复合拆分算法一句话)
- 测试清单(新增接受/仍拒绝/边界)
- 门禁结果(npm test / typecheck / docs-check / diff --check)
- 遇到的问题(若有)
- 证据(测试摘要行、commit 列表)
- 末两行 token(必须精确):
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

**不要 merge、不要 push、不要碰主树。worktree 已预建。**
