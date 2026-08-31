# Workstream: auth-modal-opacity — 登录弹窗降透明度(提高不透明度)

## 背景

用户反馈登录弹窗太透。根因:`server/src/components/auth-modal.module.css:67` 亮色卡片背景渐变
`rgba(255,255,255,0.42) → rgba(255,255,255,0.18)`(暗色 `:389-393` `rgba(32,40,46,0.62) → rgba(20,26,30,0.42)`),
配合 blur(36px) 后内容透出明显。

## 目标(用户指定:调低透明度,不要那么透)

仅改 `.card` 背景 alpha,保留玻璃质感(blur/border/inset highlight/shadow 不动):

```
现状(亮):  linear-gradient(160deg, rgba(255,255,255,0.42), rgba(255,255,255,0.18))
目标(亮):  linear-gradient(160deg, rgba(255,255,255,0.90), rgba(255,255,255,0.84))

现状(暗):  linear-gradient(160deg, rgba(32,40,46,0.62), rgba(20,26,30,0.42))
目标(暗):  linear-gradient(160deg, rgba(32,40,46,0.90), rgba(20,26,30,0.84))
```

数值取向:落在面板 frost 档(--soft-strong 亮 0.84-0.90 / 暗 0.84-0.88)上限附近,接近磨砂实底;
若你觉得 0.90/0.84 仍偏透可上浮到 0.94/0.90,但保持渐变方向与玻璃感。

## 文件边界

- **只改** `server/src/components/auth-modal.module.css`(两处:.card 亮色 + @media dark .card)
- 不碰 auth-modal.tsx、i18n、任何其他文件
- 不跑 npm install;提交用 Conventional Commits(`fix(auth): 登录弹窗卡片提高不透明度…`)

## 门禁(全绿才算完成)

```bash
cd /Users/acccan/dm-wt-auth-opacity/server && npm test
cd /Users/acccan/dm-wt-auth-opacity/server && npm run typecheck
cd /Users/acccan/dm-wt-auth-opacity && make docs-check   # 若无 Makefile 回主仓库根跑
cd /Users/acccan/dm-wt-auth-opacity && git diff --check
```
docs-check 若有他批产物自匹配命中(与本分支无关的已知问题),在汇报中说明即可,不算 FAILED。

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-auth-modal-opacity/reports/auth-modal-opacity.md`:
改动文件、最终色值、门禁结果、「遇到的问题」段。**末两行必须精确为**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
