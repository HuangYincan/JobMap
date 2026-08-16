# Makefile for Domain Map Platform (Phase 1 scaffold)
.PHONY: help db-up db-down db-status docs-check scaffold-status preflight db-migrate test-unit test-integration

help: ## Show currently supported commands
	@printf '%s\n' 'Domain Map Platform'
	@printf '%s\n' '  make preflight        Verify DATABASE_URL and PostGIS preflight'
	@printf '%s\n' '  make db-up            Start the local PostGIS database'
	@printf '%s\n' '  make db-migrate       Apply pending SQL migrations (requires DATABASE_URL)'
	@printf '%s\n' '  make test-unit        Run importer unit tests (no database required)'
	@printf '%s\n' '  make crawl-official   Dry-run polite GET of official careerUrl pages (no write)'
	@printf '%s\n' '  make refresh-radar     Download reviewed radar snapshot and remap drops'
	@printf '%s\n' '  make test-integration Run database integration tests (SKIP/BLOCKED if unavailable)'
	@printf '%s\n' '  make docs-check       Reject stale canonical documentation references'
	@printf '%s\n' '  make scaffold-status  Show implementation prerequisites present/planned'

db-up: ## Start local PostGIS database
	docker compose up -d db

db-down: ## Stop local PostGIS database
	docker compose down

db-status: ## Show database service status
	docker compose ps db

preflight: ## Verify DATABASE_URL and PostGIS availability
	db/scripts/preflight.sh

db-migrate: ## Apply pending SQL migrations (requires DATABASE_URL)
	db/scripts/apply.sh

test-unit: ## Run importer unit tests (no database required)
	cd crawler && PYTHONPATH=app python3 -m unittest discover -s tests -v

crawl-official: ## Dry-run polite GET of curated official career pages (no file write)
	cd crawler && PYTHONPATH=app python3 -m domain_map_importer.cli official --dir ../server/data/recruitment/official-career --limit 5 --interval 2

refresh-radar: ## Download the reviewed radar snapshot, remap drops, and validate the import plan
	@mkdir -p /tmp/domain-map-radar
	@curl -sL --max-time 90 -o /tmp/domain-map-radar/jobs.json "https://raw.githubusercontent.com/jiabaobei/xiaozhao-radar/main/jobs.json"
	@shasum -a 256 /tmp/domain-map-radar/jobs.json
	@cd crawler && PYTHONPATH=app python3 -m domain_map_importer.cli radar \
		--input /tmp/domain-map-radar/jobs.json \
		--out-dir ../server/data/recruitment/radar
	@rm -f server/data/recruitment/radar/_radar-fixture.json
	@cd crawler && PYTHONPATH=app python3 -m unittest discover -s tests -q >/dev/null && echo "crawler tests OK"
	@cd server && node --experimental-strip-types --no-warnings scripts/plan-seed-import.mjs 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'import plan: {d[\"companies\"]} companies / {d[\"positions\"]} positions, {len(d[\"issues\"])} issues, {d[\"dropped\"]} dropped'); sys.exit(1 if d[\"dropped\"] or d[\"issues\"] else 0)" && echo "import plan OK"
	@echo "Refresh done. Record the SHA-256 in tech/roles/data/data-quality.md."

test-integration: ## Run database integration tests (SKIP/BLOCKED if unavailable)
	tests/integration/db/test_migrations.sh

docs-check: ## Check repository documentation path and policy drift
	@! grep -R -nE 'docs/roles/|docs/zh-cn/|预计发布时间.*2026-02-10|BOSS.*MVP.*爬|小红书.*MVP.*爬' --include='*.md' .
	@printf '%s\n' 'Documentation policy check passed.'

scaffold-status: ## Show implementation prerequisites present/planned
	@for path in server/package.json crawler/pyproject.toml db/migrations/001_extensions_and_identity.sql db/scripts/apply.sh tests; do \
		if [ -e "$$path" ]; then printf 'present: %s\n' "$$path"; else printf 'planned: %s\n' "$$path"; fi; \
	done
