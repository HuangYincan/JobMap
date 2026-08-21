// 重命名遗留存根 (2026-08-22, ws-b data-contract-r4-sync):
// zz-w9-analysis.test.mjs → city-center-pins.test.mjs 的语义重命名已落地 (数据契约
// 本体在 city-center-pins.test.mjs, 注释已同步)。本旧路径文件因会话沙箱拦截文件
// 删除/移动 (与当初 zz- 前缀命名的限制相同) 无法从磁盘移除, 故留此存根: 指向新
// 语义名文件并守卫其存在, 不含任何契约逻辑。删除本文件需在具备文件删除权限的
// 会话执行 `git rm server/tests/zz-w9-analysis.test.mjs`。
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

test('重命名存根: city-center-pins.test.mjs 存在 (城市中心钉点数据契约本体在其内)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  assert.ok(
    existsSync(path.join(here, 'city-center-pins.test.mjs')),
    '城市中心钉点数据契约本体应存在于 city-center-pins.test.mjs',
  );
});
