-- ============================================================
-- 014_recent_entity.sql — search_history 可空实体引用列
--
-- 「最近」点击回到实体：记录时确定命中实体的条目（建议选中）把
-- 实体引用一并存下，点击时飞行 + 开详情，不再只回放查询串。
--
-- 可空 jsonb，旧行保持 NULL → 纯搜索回放。迁移未 apply 时应用侧
-- 以 42703(undefined_column) 自动退回不含 entity 列的语句，系统不崩。
-- ============================================================

ALTER TABLE search_history
  ADD COLUMN IF NOT EXISTS entity jsonb;
