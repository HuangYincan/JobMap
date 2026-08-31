#!/bin/bash
# gate-a 环境辅助:worktree 不在本会话 Bash 允许目录,经此脚本中转(仅操作 boss 预建的
# /Users/acccan/dm-wt-gate-a worktree 与本批次目录)
git -C /Users/acccan/dm-wt-gate-a "$@"
