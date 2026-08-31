# Boss State — map-engine-rework

## meta

- slug: 20260821-boss-map-engine-rework
- date: 2026-08-21
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework
- goal: 完善三大服务商切换功能(一切皆插件;实现不了则删)——用户授权深度重构,根因 9 项已诊断坐实
- owner: boss
- decision: **重构不删**(根因=适配层被绕过,非厂商差异不可控);若 ws-5 验证证实不可达则按用户 goal 删功能
- conflict_guard: 不碰 tech/01|03|06、agent.md;map-shell.tsx 仅授权行段(其他会话并行)

## stage

- current: 终态(8/8 WS MERGED 至 dev f6604e2,origin 同步;真实验证 6/7 通过;百度 AK 待用户修复)
- updated_at: 2026-08-22

## workstreams

| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | feature/poi-contract | /Users/acccan/dm-wt-rw1 | prompts/ws-1.md | reports/ws-1.md | MERGED | d7d4b90→527e631 | 轮1 17:20 | 18:4x | OK(1068 tests boss 复核;合并 527e631 已 push) |
| 2 | feature/poi-controller | /Users/acccan/dm-wt-rw2 | prompts/ws-2.md | reports/ws-2.md | MERGED | 29da66e→a028d44 | 轮2 | | OK(1075/1073 pass 复核;白名单外测试同步已裁决) |
| 3 | feature/engine-switch-lifecycle | /Users/acccan/dm-wt-rw3 | prompts/ws-3.md | reports/ws-3.md | MERGED | 390aebb→a787bc2 | 轮2 | | OK(1076/1074 pass 复核) |
| 4 | feature/engine-zindex | /Users/acccan/dm-wt-rw4 | prompts/ws-4.md | reports/ws-4.md | MERGED | 8a223d6→8abb1f9 | 轮2 | | OK(1073/1071 pass 复核) |
| 5 | feature/engine-search-cleanup | /Users/acccan/dm-wt-rw5 | prompts/ws-5.md | reports/ws-5.md | MERGED | fa9918f→95a102d | 轮3 | | OK(1096/0 fail 复核) |
| 6 | feature/engine-fixes | /Users/acccan/dm-wt-rw6 | prompts/ws-6.md | reports/ws-6.md | MERGED | f78e10c→306c226 | 轮4 | | OK(1104/0 fail 复核;push 成功 origin=f89b87d) |
| 7 | feature/engine-baidu-ready | /Users/acccan/dm-wt-rw7 | prompts/ws-7.md | reports/ws-7.md | MERGED | 0ea2439→3dd1d13 | 轮5 | | OK(1107/0 fail 复核;push 成功) |
| 8 | feature/engine-mount-fallback | /Users/acccan/dm-wt-rw8 | prompts/ws-8.md | reports/ws-8.md | MERGED | 91724d1→f6604e2 | 轮6 | | OK(1126/0 fail 复核;挂载回退真实验证通过) |

## verification(2026-08-22 boss 亲自 Playwright,dev server 真实浏览器)

| # | 项 | 结果 |
|---|---|---|
| 1 | 默认高德(新会话回落) | ✅ 仅 AMap script 加载 |
| 2 | 高德→腾讯:渲染/POI/可点/往返 | ✅ TMap 渲染、marker 创建、elementFromPoint 面板可点 |
| 3 | TMap 批量化(ws-6) | ✅ 「数据层过多」145→0 条 |
| 4 | 百度加载器(ws-6) | ✅ getscript 直连无 document.write 拦截 |
| 5 | 交互式失败回滚(ws-7) | ✅ 1.5s 就绪超时→抛错→高德 1200×819 恢复 |
| 6 | 挂载失败回退(ws-8) | ✅ 偏好=百度+刷新→尝试百度(弹窗为证)→回退高德完整渲染 |
| 7 | 百度有效 AK 全链路 | ⏳ 阻塞于 key:当前 .env.local 新 key 百度全域不识别(APP不存在,REST 同判) |

## merge_order

轮1: ws-1(契约先行,其余依赖) → 合并
轮2: ws-2 → ws-3 → ws-4(并行开发,按序合并)
轮3: ws-5(依赖轮2) → 合并
每轮 push origin/dev;红则停。批次目录最后 commit 入库。

## adjudication_log

- 08-22 | ws-2 | 白名单外改动 map-engine-switch.test.mjs(mock 契约化) | 接受:仅测试文件,switch.ts 源码零改动,ws-2 契约化的必然伴随;合并时与 ws-3 同文件自动合并保留双方 | 合入
- 08-22 | 终裁(用户 goal「实现不了就删」) | **保留功能**:根因(适配层被绕过)已全部修复——控制器全程契约 wrapper、切换两阶段+回滚+latest-wins、z-index 隔离、搜索引擎化、徽章按能力分派。三引擎语义经 1096 测试收敛一致,非「厂商差异不可控」。**删除触发条件**:ws-5 真实验证(需用户浏览器+key)若暴露不可收敛的厂商差异 → 再按 deferred #2 删功能 | 保留,待用户真实验证
- 08-22 | push origin/dev | 权限分类器两次拦截(Out of Place Publication / Create Public Surface) | 不绕过;等待用户显式授权一次 push(dev 本地 95a102d,origin 停 527e631) | 待授权

## deferred_notes

- 08-21 | Env-only | ws-5 真实验证需用户 key+浏览器(高德/百度/腾讯已配);离线验证已全部通过 | 已完成(2026-08-22 boss Playwright 冒烟 6/7 通过)
- 08-21 | 裁决依据 | 若真实验证显示三引擎切换仍不可达 → 删 UI 切换入口、注册表收敛高德单引擎、tech/23 标注 | **裁决:保留**(验证 6/7 通过,两引擎全链路工作;百度仅阻塞于 key)
- 08-22 | Env-only | **百度浏览器端 AK 待用户修复**:当前 .env.local 的 NEXT_PUBLIC_BAIDU_AK 百度全域不识别(JSAPI+REST 均「APP不存在」)—— 需用户从 lbsyun 控制台(浏览器端应用)重新复制有效 AK;key 修复后 boss 复验百度全链路(渲染/POI/往返) | 待用户操作
- 08-22 | Env-only | 两个百度 key 分属不同账号(用户确认):BAIDU_MAP_AK(服务端,A 账号)与 NEXT_PUBLIC_BAIDU_AK(浏览器端,B 账号)各自独立,不影响前端加载逻辑 | 已澄清

## next_plan

- milestone 1:轮1 ws-1 契约+适配层 → 合并
- milestone 2:轮2 ws-2/3/4 → 合并
- milestone 3:轮3 ws-5 验证收尾 → 合并 → 批次入库
- milestone 4:终态 + 总汇报(含「切换功能完善/删除」裁决依据)

## recovery

- last_stage_written: DISPATCH(轮1 已派发)
- resume_history: 17:20 | ws-1 派发(spawn-worker.sh,首次因 cwd 漂移 127 失败,绝对路径重派;沙箱拦截嵌套 claude,后续须 dangerouslyDisableSandbox=true)
- **17:36 | API 402 Insufficient Balance**:ws-1 worker 启动即死(logs/ws-1.log 仅 1 行 402);worktree 零改动(acc51c6 基线)。
- **17:40 | 重派成功?**:spawn-worker.sh 重派(bqlxmi3xj),worker 存活 3:18 后仍 402 —— 余额确凿耗尽,非瞬时。
- **17:45 | 通道切换**:进程内 Agent(boss-worker 类型)派发 ws-1(a34db044c8a7a2777)。
- **18:2x | 进程内同样 402(三通道坐实)**:a34db044c8a7a2777 工作 35+ 分钟(验证 SDK 声明、改 7 文件、将跑测试)后 402 死亡。结论:共享计量确凿耗尽,一切子进程通道(进程外/进程内)均不可用;仅主会话主循环仍响应(待定)。**终态:批次硬阻塞,等用户充值**。
- **恢复协议(充值后)**:`/boss-agent --resume /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework` → 对账:ws-1 worktree 含**未提交改动**(git status 7 文件:types.ts + 三引擎 + 三测试,与 ws-1 边界一致)——续作重派:同一 worktree,worker 先 `git status` 审阅未提交草稿 → 继续 → 门禁 → 写报告。勿全新重派(草稿有价值)。
