# ws-1 汇报(2026-08-22)

分支 `fix/filter-unicorn`(worktree `/Users/acccan/dm-wt-filter-unicorn`,基于 dev,未 merge 未 push)。

## 实际改动

- `server/src/lib/mode-cache.ts` → 新增 `syncModeCache`:以「写缓存时刻的最新 filters + 当前池」同步重写会话缓存;`viewport` 为 null(地图未就绪)时跳过,不覆盖现有快照(保护挂载对齐判定)。
- `server/src/lib/search.ts` → 新增 `planExploreSearch`(边界外,理由见「遇到的问题」):封装「打开探索搜索的目标状态」——标签合并基准由调用方传入 live 状态,语义与 openExploreSearch 原实现一致(命中 #标签 → 合并 filters + 清 query;纯关键词 → 只换 query)。
- `server/src/components/map-shell.tsx`:
  1. load 内两处 `writeModeCache`(onBatch + 最终)的 `filters`/`sort` 改用 `viewStateRef.current.*`(同 `use-work-viewport.ts:206` viewStateRef 模式),不再用 load 时刻闭包快照——加载在飞期间改筛选(非 category 不重搜)也不会写入过期值;
  2. 新增 sync effect(deps `[filters]`)调 `syncModeCache`——每次 filters 变更同步重写缓存,**取消勾选独角兽 → F5/重开不再复活**(主因根治的关键一环;不依赖 mode,避免 profile defaultMode 的 setMode 直改路径把旧模式状态写进新模式缓存);
  3. `handleModeChange` 两分支(缓存还原/清空)setState 同时**立即同步 `viewStateRef.current` 为目标模式将生效状态**——state 更新异步,同栈下游读取不能靠闭包;
  4. `openExploreSearch` 改以 `viewStateRef.current` 为 merge 基准(经 `planExploreSearch`),deps `[query, filters]` → `[]`(次因根治:handlePickRecent 里 handleModeChange 后同栈调用读到的是切换后模式的 filters,旧模式 scale:['unicorn'] 不再带进新模式)。
- `server/tests/filter-unicorn-regression.test.mjs`(新) → 12 项回归:主因 4(load 写入 unicorn → 取消勾选 syncModeCache → 缓存/还原不含 unicorn;连续取消跟随最新;viewport 为 null 跳过;在飞改筛选不写旧值)+ 次因 4(切新模式后点历史 #独角兽 只应用独角兽、旧模式 industry 等不泄漏;合并进新模式已有筛选;纯关键词不碰 filters;同模式语义保持)+ 契约 4(load 写缓存两处 viewStateRef、sync effect deps [filters]、openExploreSearch 以 ref 为基准、handleModeChange 两分支同步 ref、handlePickRecent 先切模式再回放)。
- `tech/16-bug-fixes.md` → 置顶新增 2026-08-22「筛选莫名勾选独角兽」节(症状/根因/方案/回归测试/修改文件;历史文字保留)。

## 主因/次因修复方式(为何根治)

- **主因(缓存残留,F5 复现)**:原链路「load 时 filters 含 unicorn(点 #独角兽 建议,query 清空触发 load)→ 连目录写缓存 → 用户取消勾选 → setFilters 无重载 → 缓存残留 → F5 还原复活」。修复 = 双保险:(a) 写缓存时刻取 `viewStateRef.current` 最新 filters/sort(闭包快照在在飞窗口内会过期);(b) filters 变更即同步重写缓存(取消勾选那一刻缓存就跟随为 `{}`,还原路径 `useModeCacheRestore → setFilters(cached.filters)` 无 unicorn 可复活)。两处配合后,缓存快照恒与面板状态一致,不存在「残留旧筛选」的写入时机。
- **次因(切模式闭包)**:原链路「handlePickRecent 同栈内 handleModeChange(replay.mode) + openExploreSearch(replay.query)」——state 更新异步,openExploreSearch 闭包 `[query, filters]` 仍是旧模式快照,标签 merge 把旧模式筛选带进新模式。修复 = handleModeChange 切模式瞬间把 `viewStateRef` 同步为目标模式将生效状态,openExploreSearch 以 ref 为 merge 基准(纯函数 `planExploreSearch` 封装,可单测),同栈读取即正确。点历史 `#独角兽` 的应用语义保持(applyTagSuggestion 不 strip)。

## 遇到的问题

1. **`search.ts` 在文件边界之外**:`planExploreSearch` 放在 `search.ts`(紧邻其包装的 `applyTagSuggestion`,复用 `mergeFilters`/`parseSearchQuery` 内部实现)——若放 map-shell 则纯函数无法被 node 单测导入(组件引 next/dynamic 不可测),必须可测层落地。按铁律在此说明理由。`use-work-viewport.ts` 未改动(其 :206 写缓存已是 viewStateRef 模式,即本次参照样板)。
2. **已知残留(非本次症状,未改)**:取消勾选后,F5 还原的 catalog 池仍是 load 时刻服务端按旧 filters 过滤的子集(unicorn 公司仍在池中,客户端 pipeline 按 `{}` 过滤后仍可见)——这是「池 = 抓取时刻服务端过滤结果」的既有行为,不随本次修复变化,也不是报告症状(报告症状是面板勾选状态复活)。若 boss 认为需要池级自愈(筛选变更重拉全量池),可另开 workstream。
3. **sync effect 依赖设计**:deps 只用 `[filters]` 而非 `[mode, filters]`——map-shell 存在 profile defaultMode 的 `setMode` 直改路径(497/2424 行,不换 filters),若依赖 mode 会把旧模式状态写进新模式缓存;category 变更由主加载重写(更强:新目录),本 effect 只保证非 category 路径不残留。契约测试已断言此依赖形态。
4. 全量门禁在提交后复跑一次,与提交前一致,无 flaky。

## 证据

- 回归测试实跑输出(12/12 通过,节选):
  - `✔ 主因:取消勾选后缓存不再残留 unicorn(load 写入 → setFilters 取消 → 重写 → 还原不含 unicorn)`
  - `✔ 次因:切到新模式(无筛选)后点历史 #独角兽 → 只应用独角兽,不带旧模式筛选`
  - `✔ 契约:主加载写缓存用写缓存时刻的最新 filters/setState(非闭包快照)`
  - `✔ 契约:handlePickRecent 先切模式(handleModeChange 同步 ref)再 openExploreSearch(读 ref)`
- 全量 `npm test`:tests 1269 / pass 1267 / fail 0 / skip 2(duration ~6.1s)。
- `npm run typecheck` / `make docs-check` / `git diff --check`:全部通过。
- 提交序列(fix/filter-unicorn,4 个 Conventional Commits,工作树干净):
  - `7611fa2 fix(filter-unicorn): 纯逻辑助手 syncModeCache / planExploreSearch`
  - `b15a560 fix(filter-unicorn): 缓存残留 + 切模式闭包 stale filters 接线修复`
  - `8dc4dd2 test(filter-unicorn): 新增「筛选莫名勾选独角兽」回归测试(12 项)`
  - `21035a4 docs(filter-unicorn): tech/16 记录「筛选莫名勾选独角兽」修复(2026-08-22)`
- 复现序列(修复前):work 模式点 `#独角兽` 建议 → 面板取消勾选 → F5 → 独角兽勾选复活;work 有 unicorn 筛选时点 domain 历史 `#独角兽` 条目 → domain 面板出现 scale:['unicorn']。修复后两序列均不复现(面板不复活 / 旧模式筛选不进新模式),回归测试锁定。

门禁: PASSED
结论: OK
