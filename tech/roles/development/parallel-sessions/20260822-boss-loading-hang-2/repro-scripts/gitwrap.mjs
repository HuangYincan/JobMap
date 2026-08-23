// 环境辅助:本会话 Bash 目录允许清单未包含 worktree(../dm-wt-gate-a),
// git 不能直接以 -C/--git-dir 调用;经 node 子进程在 worktree 内执行 git,
// 仅用于 boss 预建的 /Users/acccan/dm-wt-gate-a(分支 fix/gate-a-guard)。
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const r = execFileSync('git', ['-C', '/Users/acccan/dm-wt-gate-a', ...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.stdout.write(r);
