# 合并报告(2026-08-22,resume)

## 结果总览

- 成功合并: ws-backend / ws-frontend / ws-docs × 3(全部并入 dev 并 push origin/dev)
- 失败/遗留: 无
- 说明: 本报告为 resume 终稿(首轮 03:38 报告 BLOCKED 后,boss 裁决豁免 pre-existing 测试红并指示按 ws-frontend → ws-docs 续跑)。ws-backend 已在首轮并入 dev(本地 `d22c3f8`,后随其他批次 `601b045` push),本轮幂等跳过并清理 worktree/分支。
- **门禁豁免裁定(boss 2026-08-22 03:42)**: 主树 `npm test` 唯一 1 项失败为 `embodied-jobs 语料` 契约测试,根因是**并发会话遗留的未提交 geocode 残留**(`server/data/recruitment/**` 被加 `location.lng/lat`,`embj-迦智科技.json` 违反已提交契约测试)→ 判定 pre-existing,豁免通过。本轮两次全量测试(ws-frontend、ws-docs merge 后各一次)均为 `1256 tests / 1253 pass / 1 fail`,失败项恒定为此测试,零 oauth 相关失败。
- 未提交残留(`server/data/recruitment/**`、`server/next-env.d.ts`、未跟踪批次目录)全程未 touch(未 checkout / 未 stash / 未 commit / 未 include)。

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-backend | feature/oauth-backend | 已并入 dev(首轮 `d22c3f8`,已 push)→ 幂等跳过,worktree/分支清理 | 见首轮报告(pre-existing 豁免);本轮未重跑 | 无 |
| ws-frontend | feature/oauth-frontend | `--no-ff` merge → `e8d07ca`(dev),已 push | npm test 1253/1(豁免项)/0 新红;typecheck 通过;docs-check 通过;diff-check 通过(含 staged) | 无冲突(map-shell.tsx / i18n.ts 与 agent-memory-ui 改动的三路合并自动干净完成) |
| ws-docs | feature/oauth-docs | `--no-ff` merge → `9300fd1`(dev),已 push | npm test 1253/1(豁免项)/0 新红;typecheck 通过;docs-check 通过;diff-check 通过(含 staged) | 3 文件冲突,按两方「不碰」双方内容并留(见下) |

## 冲突解决清单

ws-docs merge 期间 3 处冲突(根因:oauth-docs 分支基于旧 dev,期间 aliyun-sms / agent-memory / navi 等批次已并入 dev 改动同文件):

1. **`server/.env.example`**: HEAD 有「短信(阿里云)」段,oauth-docs 加「第三方登录(OAuth)」段 → 两段并留(阿里云段属既有并入内容,ws-docs 不碰;OAuth 段是 ws-docs 交付物)。
2. **`tech/14-api-contract.md`**: HEAD 的 OTP 行(2026-08-22 phone 已走阿里云真发,更新版)保留;HEAD 旧「OAuth UI / demo map」行被 oauth-docs 新「真实 OAuth 三件套」行替换(ws-docs 任务本身,且保留「Do not add X」句)。
3. **`tech/README.md`**: 索引两行 `26-aliyun-sms` / `26-agent-memory`(HEAD)与一行 `27-oauth-login`(oauth-docs)并留,顺序 26 → 26 → 27。

## 遗留问题

1. **主树未提交残留(非本批,勿动,待所属批次/用户处理)**: 48 个 `server/data/recruitment/**/*.json`(geocode lng/lat 回填,其中 `embj-远智科技.json`/`embj-迦智科技.json` 等违反 embodied-jobs 契约测试,`npm test` 持续 1 红)、`server/next-env.d.ts`、`tech/roles/development/parallel-sessions/20260821-*/` 未跟踪批次目录、`.address-work/`。合并过程零触碰。
2. **Env-only(按约定留给用户,见 deferred-notes.md / tech/27)**: GitHub/Google/微信 OAuth 三方凭据、回调 URL 注册 `<origin>/api/auth/oauth/callback/{github|google|wechat}`、微信 ICP 备案域名+应用审核、生产 `SESSION_SECRET` 显式设置。
3. 其他批次 worktree(`dm-dev-merge` detached、`domain-map-wt-nolod` `fix/work-pins-all-visible`)非本批,未动。

## 最终 dev 状态

- dev == origin/dev == `9300fd1`(含 ws-backend `d22c3f8` + ws-frontend merge `e8d07ca` + ws-docs merge `9300fd1`,及其余已并入批次)。
- 三个 oauth worktree 与分支(feature/oauth-backend / feature/oauth-frontend / feature/oauth-docs)已全部清理。
- 主工作树未提交残留原样保留;未 push main;未 force-push;未做任何 Env-only 步骤。

门禁: ALL_GREEN
结论: MERGED_ALL
