# Boss State — 20260821-boss-qqdoc-official

## meta
- slug: 20260821-boss-qqdoc-official
- date: 2026-08-21
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-qqdoc-official
- goal: 腾讯文档官方招聘平台源落地(用户提供的高质量源,替代低质校招雷达)+ 官网地址提取
- owner: boss-agent
- dev_tip: 1ec3fff(合并后)

## stage
- current: DONE(数据已合并;import 完成)
- updated_at: 2026-08-21

## 结论
- 腾讯文档「官方招聘平台汇总」203 条 → 清洗 144 家央企/银行/国企(与现有 catalog 重叠仅 7,新增 137)
- w1 feat/qqdoc-official-source:MERGED_ALL(1ec3fff),门禁 566 pass/2 skip
- 官网地址提取:92 家真实城市 / 19 家街道地址(「海淀区复兴路69号9号楼中国中铁大厦」级)/ 50 家 city-pending;合规:第三方平台 0 请求、robots 先行
- import:830 家 / 2101 站点 / 11492 岗位入库(0 dropped)
- **关键发现**:工作模式 POI 需「岗位 + 坐标」(server-catalog.ts:53);qqdoc 142 家无岗位 → 地图暂不显示 → **官网岗位提取为下一批**(官方招聘页解析岗位)

## workstreams
| ws | 主题 | 分支 | status | verdict |
|---|---|---|---|---|
| w1 | qqdoc 源落地 + 官网地址提取 | feat/qqdoc-official-source | MERGED | OK |

## deferred/next
- 官网岗位提取(144 家招聘页解析岗位 → positions drops)→ 下一批建议
- 50 家 city-pending:官网未公开地址,记录待合规渠道补
- 腾讯 key 兜底(1205626,.env.example TENCENT_MAP_KEY)—— geocode 三源兜底,已入库待验证

## recovery
- last_stage_written: DONE
