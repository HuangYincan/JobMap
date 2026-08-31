# ws-qa4 汇报(2026-08-19)

## 实际改动(分支 fix/qa-deadcode,worktree /Users/acccan/dm-wt-qa4,3 个小步 commit)

### #8 删除 MODES.internship 死代码
- `server/src/lib/modes.ts` → 删除 `MODES.internship` 条目(190-203 行,与 work 完全重复)。
- 类型处理:`MapMode` 仍含 `'internship'`(历史值,canonicalMode/isRecruitmentMode 需要),而
  `app/api/filter-options/route.ts`(不碰)与 `components/mode-switcher.tsx`(不在只动清单)直接
  用 `MapMode` 索引 `MODES[mode]` 后取 `config.name`。因此:
  - MODES 类型改为 `Record<Exclude<MapMode, 'internship'>, ModeConfig> & { internship: never }`
    (对象字面量经双重断言省略该键,运行时无此条目)。
  - `internship: never`(必选,非可选)守卫:让 `MODES[MapMode]` 恒为 `ModeConfig`(never 被联合
    吸收,无 TS18048),同时直接读 `MODES.internship` 得 never——类型层面同样禁止访问。
  - 先试过 `internship?: never`(可选)方案:typecheck 报 `config is possibly undefined`
    (可选键给联合加 undefined),故改必选 + 断言。
- 其余条目与顺序保持(`Object.keys(MODES) === ['domain','work','college','overseas']`,测试断言)。
- `canonicalMode`/`ACTIVE_MODES`/`ALL_MODES` 签名未动(保持 MapMode,最小改动面)。

### #9 删除 api.ts 死导出 + 更新过时注释
- `server/src/lib/api.ts` → 删除 `fetchPOIs`(死导出,客户端已改由 poi-service 服务端聚合)、
  `fetchModes`(死导出);连带删除仅服务于 fetchPOIs 的 `POIQuery`/`POIListResponse` 类型与
  不再使用的 `FilterState` import。
- 头部注释更新为当前契约:客户端直连 GET /api/suggest、GET /api/pois/[id];GET /api/modes
  备用;GET /api/pois、POST /api/search、GET /api/filter-options 为服务端用;数据源已是
  Postgres(原「Phase 2 seed/AMap,DB 就绪后无缝切换」「GET /api/search」过时描述删除)。
- 存活导出保留:`fetchPOIDetail`、`fetchSearchSuggest`、`SearchSuggestion`、`SuggestResponse`、
  `ApiError`(request 内部使用 + 错误形状契约)。

### 测试
- 新增 `server/tests/modes.test.mjs`(5 个用例):
  1. MODES 无 internship 条目,键顺序 = domain/work/college/overseas;
  2. canonicalMode('internship') === 'work'(其余原样);
  3. getMode('internship') 落到 work 配置;
  4. ACTIVE_MODES/ALL_MODES 不含 internship,索引 MODES 恒有效;
  5. api.ts 模块无 fetchPOIs/fetchModes 导出,存活导出仍在。

## 门禁结果
- npm test: 428 通过 / 0 失败(426 pass + 2 skipped,跳过为既有)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## 遇到的问题
1. **删条目后类型连锁**(已解决):`Record<MapMode, ModeConfig>` 不能缺 internship 键;直接收窄
   为 `Record<Exclude<...>>` 会让边界外文件(`app/api/filter-options/route.ts`、`components/
   mode-switcher.tsx`)报 TS7053,而这两处不在我的可动清单。最终用「必选 never 键 + 双重断言」
   让所有既有消费者(含边界外)零改动编译通过,详见上文类型处理。
2. 汇报 grep 语句含 `fetchPOIsForMode`(poi-service 的另一个符号,非死代码)子串匹配,已用
   `grep -v fetchPOIsForMode` 排除;剩余匹配仅为我的守卫注释与回归测试断言(有意保留标识符)。

## 证据
- grep 零残留(精确命令 `grep -rn "MODES\.internship\|fetchPOIs\|fetchModes" server/src server/tests`,
  排除无关符号 `fetchPOIsForMode` 后):
  ```
  server/src/lib/modes.ts:144:  // ModeConfig),而直接读取 MODES.internship 得到 never——类型层面同样禁止访问。
  server/tests/modes.test.mjs:3:  // - api.ts 不再导出 fetchPOIs / fetchModes 死函数
  server/tests/modes.test.mjs:17:  assert.equal('internship' in MODES, false, 'MODES.internship 已删除');
  server/tests/modes.test.mjs:29:  test('getMode: internship 落到 work 配置(不读 MODES.internship)', () => {
  server/tests/modes.test.mjs:43:  test('api.ts: fetchPOIs / fetchModes 死导出已删除,存活导出仍在', () => {
  server/tests/modes.test.mjs:44:  assert.equal(typeof api.fetchPOIs, 'undefined', 'fetchPOIs 已删');
  server/tests/modes.test.mjs:45:  assert.equal(typeof api.fetchModes, 'undefined', 'fetchModes 已删');
  ```
  → 实际代码零残留;守卫注释与回归测试文件中的字面标识符为有意保留。
- 测试输出摘要:426 pass / 0 fail / 2 skip(duration 1.77s);新测试 5 例全部执行通过。
- commits: `0bb18f4`(modes.ts)、`b8d034e`(api.ts)、`c41e90e`(tests),均只含各自文件。

门禁: PASSED
结论: OK
