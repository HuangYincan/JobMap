#!/usr/bin/env bash
# boss-agent · spawn one headless boss-worker in its pre-built worktree.
#
# Usage:
#   bash spawn-worker.sh <ws> <worktreeAbs> <batchDirAbs>
#
#   <ws>          workstream id, e.g. w1
#   <worktreeAbs> absolute path to the pre-built worktree, e.g. /Users/acccan/dm-wt-w1
#   <batchDirAbs> absolute path to the batch dir, e.g.
#                 /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-<slug>
#
# Reads the prompt from <batchDir>/prompts/<ws>.md (stdin), writes stdout to
# <batchDir>/logs/<ws>.log. Run with the Bash tool run_in_background=true so the
# boss gets a completion notification when the worker exits.
set -euo pipefail
WS="$1"; WORKTREE="$2"; BATCH="$3"
LOG="$BATCH/logs/$WS.log"

mkdir -p "$BATCH/logs" "$BATCH/reports"
cd "$WORKTREE"

claude -p \
  --agent boss-worker \
  --name "boss-w-$WS" \
  --output-format text \
  --allowedTools "Read, Edit, Write, Grep, Glob, Search, Bash(cd*), Bash(git status*), Bash(git log*), Bash(git diff*), Bash(git show*), Bash(git branch*), Bash(git add*), Bash(git commit*), Bash(git merge dev), Bash(npm*), Bash(make docs-check*), Bash(cat*), Bash(grep*), Bash(find*), Bash(ls*), Bash(pwd)" \
  --disallowedTools "Bash(git push*), Bash(git worktree*), Bash(git switch*), Bash(git checkout*), Bash(git reset --hard*), Bash(git rebase*), Bash(git clean*), Bash(git stash*), Bash(npm install*), Bash(npm ci*), Bash(npm run import:*), Bash(npm run geocode:*), Bash(npm audit*), Bash(npx*), Bash(export*), Bash(chmod*), Bash(rm -rf*), Bash(sudo*), Bash(make db-*), Bash(make crawl-official*), Bash(make refresh-radar*), Bash(make geocode-sites*)" \
  --add-dir "$BATCH" \
  --max-budget-usd 3.0 \
  < "$BATCH/prompts/$WS.md" \
  > "$LOG" 2>&1

# Exit with claude's exit code so run_in_background completion reflects success.
exit $?
