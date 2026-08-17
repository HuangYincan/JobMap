---
name: parallel-development
description: Worktree-first parallel development for Domain Map — every concurrent task or branch (and every parallel subagent) develops in its own git worktree cut from `dev`, then merges back to `dev`. Use when starting a new feature/fix, spawning parallel subagents, or resolving branch conflicts.
---

# Parallel Development (worktree-first)

Domain Map may be developed by several agent sessions at once (frontend,
backend, database). This skill keeps parallel branches mergeable and the main
working tree stable. The user's stated principle (2026-08-17): **always develop
inside a git worktree; branch flow is `dev` → `feature/…`/`fix/…` → back to `dev`.**

## Rules

1. Never develop a parallel task directly on the main working tree — always create a worktree.
2. Branch: `feature/<scope>` / `fix/<scope>` cut from `dev`, merged back to `dev` when green. `main` is user-only release promotion.
3. Subagents each get their own worktree + branch; they return conclusions and evidence, not file dumps — keeps the main agent's context clean.
4. Conflicts are resolved per-worktree (small, reviewable), never by clobbering a shared checkout.

## Create a worktree

```bash
# from repo root
git switch dev && git pull --ff-only origin dev
git worktree add -b feature/<scope> ../domain-map-wt-<scope> dev
cd ../domain-map-wt-<scope>
```

Claude Code: `EnterWorktree` creates a worktree under `.claude/worktrees/` on a
fresh branch; `ExitWorktree` leaves or removes it.

## During development

- Keep the branch small and frequently synced — `git merge dev` (or `git rebase dev`) inside the worktree so divergences stay small.
- Run the project gates before merging: `cd server && npm test && npm run typecheck`, `make docs-check`, `git diff --check`.
- Commit on the feature branch with Conventional Commits.

## Merge back to `dev`

```bash
cd /Users/acccan/domain-map          # back on the main tree
git switch dev && git pull --ff-only origin dev
git merge --no-ff feature/<scope>   # keep a merge commit per feature
git worktree remove ../domain-map-wt-<scope>
git push origin dev
```

## Conflict handling

- Conflicts are local to a worktree: resolve there (edit + `git add`), commit, then merge back.
- Because each branch is a separate directory, parallel work never overwrites another branch's files.

## Subagent pattern (main-agent context hygiene)

- Give each parallel subagent its own worktree + branch (`isolation` keeps them disjoint).
- The subagent works only in its worktree, runs its own tests, and returns: what changed, test results, evidence. It does not paste file contents back.
- The main agent double-checks the returned diffs (trust-but-verify per `agent.md`), then merges to `dev`.

## Current repo state (2026-08-17)

`dev` lags `feature/phase-2-multi-mode` by 151 commits. Before cutting parallel
branches from `dev`, sync once:

```bash
git switch dev && git merge feature/phase-2-multi-mode
```

After that, new `feature/` / `fix/` branches carry the full current codebase.
