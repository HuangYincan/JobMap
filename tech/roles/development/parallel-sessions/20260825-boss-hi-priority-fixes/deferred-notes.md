# Deferred Notes — 20260825-boss-hi-priority-fixes

> 需用户决策/Env-only 项,不随本批执行。任务完成后统一告知。

1. **类型:Env-only** — fix 1 的 apply 执行:地点检索补全(城市占位/无地址站点 → 公司名+城市检索)/地理编码补全的实际 REST 调用与站点数据写回。需 `AMAP_WEB_KEY`(配额耗尽自动切 `BAIDU_MAP_AK`/`TENCENT_MAP_KEY`)+ DATABASE_URL(d-数据补全工具链交付后由用户执行或延后批次执行):
   ```bash
   cd server && npm run geocode:sites:apply -- --dry-run   # 先看计划
   cd server && npm run geocode:sites:apply                 # 确认后执行
   ```
2. **类型:口径(用户已裁定)** — 读路径 `isCityCenterPin` 过滤保留不放宽;「误伤」由数据补全(fix 1)治愈。补全 apply 未执行前,被隐藏站点仍不展示(地图像素级正确,数据逐步补齐后自然恢复)。
3. **类型:口径(需用户决策)** — tier 21(旧「永不显示」标记)公司:工作模式 LOD 取消后按「所有公司全量展示」指令随全量出现。若产品意图是「黑名单隐藏」,应另立字段而非绑定 zoom(tech/19 已注明;merger 遗留问题 #2)。
4. **类型:Env-only(用户执行)** — geocode r5 apply 数据落地后,`MODE_CACHE_VERSION` 需再 bump **v19**(v18 已被本批读路径语义占用,tech/29 §4.5/§7 已约定;`npm run geocode:sites:apply` 执行 + import:seed:apply + UI 验证后触发)。
