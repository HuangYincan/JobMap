# ws-navi3 汇报(2026-08-22)

## 实际改动

- `server/src/components/markdown-text.module.css` → 导航按钮选择器全部改为 `.md :global(.dm-navi)` /
  `.md :global(.dm-navi:hover)` / `.md :global(.dm-navi:active)`(特异性 (0,2,0),稳压 `.md a`(0,1,1);
  hover/active 因伪类实为 (0,3,0));注释写明特异性原因防回归。按钮保持白字(`color:#fff`)+ 无下划线
  (`text-decoration:none`)+ 蓝底,`.md a` 的 color/underline 不再覆盖。
- `server/src/lib/markdown-pipeline.ts` → `buildNaviWebUrl`:name 为空或缺省时 `to=lng,lat`(去尾逗号);
  非空 name 时 `to=lng,lat,name` 不变(仅 name 部分有条件拼 `,`);函数 docstring 补一句空 name 行为。
- `server/tests/markdown-pipeline.test.mjs` →
  - `buildNaviWebUrl: 空 name(缺省或空串)→ to 无尾逗号`:缺省 name 与 `&name=` 空串两断言;
  - 既有非空 name 用例(标准 URL / 大小写键名 / lng 别名)原样保留作回归(行为未变);
  - 三处曾断言 `to=lng,lat,&amp;mode=car`(尾逗号旧行为)的用例更新为无尾逗号形态,并加
    `doesNotMatch(/to=…,&/)` 负断言;
  - 新增契约测试「dm-navi 选择器带 .md 前缀且定义在 .md a 之后」:正则断言三态选择器存在、
    行首无裸 `:global(.dm-navi)`、navi 规则 index > `.md a` 规则 index、按钮块白字/无下划线/蓝底。

## 门禁结果

- npm test: 1424 通过 / 0 失败(2 skip,与基线一致)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过(无空白错误;工作树干净)

## 遇到的问题

- 无。注:门禁命令的 cwd 注意——`make docs-check` 需在 worktree 根、`npm test` 需在 `server/` 下执行。

## 证据

- `npm test` 输出摘要:`ℹ tests 1426 / pass 1424 / fail 0 / skipped 2`
- 两次全量回归(改动后、提交后)结果一致;`npm run typecheck` 零输出。
- 提交:b0b1997(CSS 特异性)+ a99f4d6(pipeline 去尾逗号 + 测试),分支 `fix/agent-navi-css`,基于 dev `ef20c09`。

门禁: PASSED
结论: OK
