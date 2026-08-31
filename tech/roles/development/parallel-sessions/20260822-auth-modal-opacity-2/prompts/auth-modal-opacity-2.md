# Workstream: auth-modal-opacity-2 — 登录弹窗更实一档(0.96/0.92)

## 背景

上一批(20260822-auth-modal-opacity,acacaf1)已把登录弹窗卡片从 0.42/0.18 提到 0.90/0.84。
用户反馈「更实」——再提高一档。

## 目标

仅改 `server/src/components/auth-modal.module.css` 两处 `.card` 背景 alpha:

```
现状(亮):  linear-gradient(160deg, rgba(255,255,255,0.90), rgba(255,255,255,0.84))
目标(亮):  linear-gradient(160deg, rgba(255,255,255,0.96), rgba(255,255,255,0.92))

现状(暗):  linear-gradient(160deg, rgba(32,40,46,0.90), rgba(20,26,30,0.84))
目标(暗):  linear-gradient(160deg, rgba(32,40,46,0.96), rgba(20,26,30,0.92))
```

保留 blur(36px)/border/inset highlight/shadow 不动,渐变方向不变。

## 文件边界

- **只改** `server/src/components/auth-modal.module.css`(:67 亮色 + :392 暗色)
- 不碰其他任何文件;不跑 npm install;Conventional Commits(`fix(auth): …`)

## 门禁

```bash
cd /Users/acccan/dm-wt-auth-opacity-2/server && npm test
cd /Users/acccan/dm-wt-auth-opacity-2/server && npm run typecheck
cd /Users/acccan/dm-wt-auth-opacity-2 && make docs-check   # 无 Makefile 则回主仓库根
cd /Users/acccan/dm-wt-auth-opacity-2 && git diff --check
```
docs-check 若有他批产物自匹配(已知问题,与本分支无关)在汇报说明即可,不算 FAILED。

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-auth-modal-opacity-2/reports/auth-modal-opacity-2.md`:改动文件、最终色值、门禁结果。**末两行必须精确为**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
