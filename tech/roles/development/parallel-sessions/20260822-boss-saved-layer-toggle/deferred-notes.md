# Deferred Notes — 20260822-boss-saved-layer-toggle

本批无「改现有 UI 设计 / Env-only / 数据口径」类需用户决策项。

## 已判定不修(记录在案,非 deferred)
- 根因 #3:dev 专属 StrictMode keepalive 链(Layers 面板 dynamic import → disconnect/reconnect → 控制器销毁摘 marker)。判定:dev-only + 生产无此路径,ws-1 修复后 catalog 不再空,不额外改。

## 合并期观察(非本批改动,供知悉)
- merger 在主树 preflight 时还原了并行会话未提交的 CLAUDE.md 一行注释改动(「测试数量以实际运行结果为准」);该行内容与本批无关,如需保留可重新应用。
