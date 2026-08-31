# ws-d 汇报(2026-08-23)

## 实际改动

分支 `docs/poi-r5-runbook`(worktree /Users/acccan/dm-wt-pds-d,自 dev HEAD dda9555 切出),3 commits:

1. `c3a567f` docs(data-quality): **tech/29 v2.0 刷新为 r5 可执行 runbook**
   - 保留 §1 根因段(三层问题原样),更新「相关」链接(加入 20260823 批次 / v17 commit 9e693a9)
   - §2 现状 → 2026-08-23 实测基线:中心钉点 1330(sitesTotal 2410)/ needsRerun 1076(cityList 929 / 真实街道 134 / 海外·其他 13)/ stayCenter 249 / noAddress 5;Top 城市上海 344 / 北京 293 / 深圳 212 / 广州 117 / 成都 116;**新增与 2026-08-22 基线 1346 的差异说明**(数据源更新所致,期间无任何 apply 执行)
   - §3 工具链核查:前置依赖行更新为「已合并(grader 放宽)」;新增 §3.1(ws-a 修复 6 站「门」误判)+ §3.2(2026-08-23 批次新增能力表:ws-a 列表串判定 / ws-b Nominatim / ws-c daily / ws-d 本文档,均标注「分支合并后生效」)
   - **新增 §4「r5 执行 runbook」**:配额事实表(三 provider place 检索各 ~100 次/日 + AMap regeo 5000 / 百度逆地理 300,来源 URL lbs.amap.com / lbsyun.baidu.com / lbs.qq.com,2026-08-23 查证)、多日排程建议(每天跑至 QUOTA_EXHAUSTED 短路 exit 2、`--cities 上海` 优先、全量 ~4 天)、每日命令 + 验证点(audit 数字下降 / drops 坐标 diff / dry-run needs 回落)、import 步骤(`npm run import:seed:apply`,Env-only,DB 1556>1330 必须执行)、UI 验证 + MODE_CACHE_VERSION bump 提示(**当前已 v17,落地后 bump v18**——修正旧文档「v16→v17」的过时表述,代码实测 v17=9e693a9)
   - §5 工具、§6 时间线更新;§7 新增 **Env-only deferred 清单**(4 项:r5 apply 多日 / import:seed:apply / UI+bump v18 / Nominatim 海外执行)
   - 修正 commit `3722c87`:其余城市口径说明(武汉 59/南京 47 等在「其余」内,细分标注 2026-08-22 口径待复算)
2. `a0581ce` docs(data-quality): **新增 `tech/roles/data/etl/search-engine-addresses.md`**
   - `.address-work/`(主工作树,百度/搜狗/360/必应 HTML 抓取)来源审查:物证清单(fetch.py UA 伪装 / search360.py SERP 解析 / bd1.html **百度验证码墙实测** / sg1.html 搜狗反爬 approve-token / cj.txt cookie jar)
   - 合规风险逐源判定(验证码墙=高、反爬风控=高、条款=中高、UA 伪装=高、cookie 持久化=高)
   - 结论:不作为正式数据源(合规红线 + 工程不可靠 + 质量不达标 + 已有替代:三 provider API / Nominatim / address-first 通道);列为 **deferred 探索项**,仅人工抽查
   - 后续使用必要条件:来源审查先行 / 限流 ≥1s / 不绕过(不求解验证码、不 cookie 复用、不伪装,遇墙即停)/ 人工复核 / 抓取代码不入库

## 门禁结果

- `make docs-check`: **通过**(Documentation policy check passed)
- `git diff --check`: **通过**(无输出);`git status` 干净
- `node scripts/audit-city-center-pins.mjs`: **未执行——本会话沙箱拦截所有 node 命令**(多次尝试均「requires approval」,含 `node -e` 冒烟测试)。替代复核:
  - 基线数字(1330/344/1076/929/249/5/2410)采用 boss 2026-08-23 实测 manifest(`20260823-boss-poi-datasource/README.md`),与任务 prompt 所述完全一致
  - 只读抽查通过:radar drops 中 metapp×2(「北京/成都/厦门」)/ 万物云×3(「广州/深圳/武汉/厦门」)/ 中电福富×1(「成都/重庆/厦门/福州」)= 6 站「门」误判事实成立;`MODE_CACHE_VERSION = 17`(9e693a9,2026-08-22 预 bump)代码实测;apply 脚本 `--cities/--only/--dry-run`、`QUOTA_SHORT_CIRCUIT_N=5`、exit 2、AMap place-text 100 次/天、regeo 5000 次/天(apply 注释)代码实测
  - 建议 boss 合并后由 merger 或用户跑一次 audit 复算收口

## 遇到的问题

- **沙箱禁 node** → audit 复核命令无法执行;以 boss manifest + 只读 Grep 抽查替代(见上),文档中已把城市级细分、来源分布标为「2026-08-23 未单独复测,以 audit 输出为准」,不臆造数字
- ws-a/b/c 均仍在运行(worktree 未见落地代码、reports 为空)→ 文档按其 prompt 能力描述引用,全部标注「2026-08-23 批次合并后生效」;若合并后实际能力与描述有出入,需 boss 裁决是否微调本文档
- 旧文档「MODE_CACHE_VERSION v16、r5 后 bump v17」已过时(代码已 v17)→ 已修正为「落地后 bump v18」
- `.address-work/` 是否被 git 跟踪未能核实(主工作树 git 命令被沙箱拦截);文档以「未进入任何管线、保持未跟踪、不提交」为审查结论,不宣称其跟踪状态

门禁: PASSED
结论: OK
