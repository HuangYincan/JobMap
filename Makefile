# Makefile for Domain Map Platform

.PHONY: help dev test test-unit test-integration test-e2e test-all lint verify clean

help: ## 显示帮助信息
	@echo "Domain Map Platform - 可用命令:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""

dev: ## 启动开发环境(数据库 + 前端)
	@echo "🚀 启动开发环境..."
	docker compose up -d db
	@sleep 3
	@cd db && bash scripts/apply.sh
	@cd server && npm run dev

test: test-unit test-integration ## 运行测试(单元 + 集成)

test-unit: ## 运行单元测试
	@echo "🧪 运行单元测试..."
	@cd server && npm run test
	@cd crawler && uv run pytest tests/unit/

test-integration: ## 运行集成测试
	@echo "🔗 运行集成测试..."
	@cd tests/integration && npm run test

test-e2e: ## 运行 E2E 测试
	@echo "🎭 运行 E2E 测试..."
	@cd tests/e2e && npx playwright test

test-all: test test-e2e ## 运行所有测试

lint: ## 代码检查
	@echo "🔍 运行代码检查..."
	@cd server && npm run lint
	@cd crawler && uv run ruff check .

format: ## 代码格式化
	@echo "✨ 格式化代码..."
	@cd server && npm run format
	@cd crawler && uv run ruff format .

verify: lint test ## 完整验证(测试 + lint + 构建)
	@echo "🏗️ 构建项目..."
	@cd server && npm run build
	@echo "✅ 验证通过!"

clean: ## 清理生成文件
	@echo "🧹 清理中..."
	@rm -rf server/.next
	@rm -rf server/node_modules
	@rm -rf crawler/.venv
	@rm -rf tests/e2e/test-results
	@echo "✅ 清理完成!"

db-reset: ## 重置数据库(危险!)
	@echo "⚠️  重置数据库..."
	@read -p "确认删除所有数据? [y/N] " confirm && [ "$$confirm" = "y" ]
	@cd db && bash scripts/reset.sh

db-migrate: ## 执行数据库迁移
	@echo "🗄️ 执行数据库迁移..."
	@cd db && bash scripts/apply.sh

seed: ## 加载种子数据
	@echo "🌱 加载种子数据..."
	@cd crawler && uv run python -m app.cli plugin:seed recruitment
	@cd crawler && uv run python -m app.cli plugin:seed housing

crawl: ## 运行爬虫(增量)
	@echo "🕷️ 运行爬虫..."
	@cd crawler && uv run python -m app.cli crawl --source xiaozhao

docker-up: ## 启动 Docker 容器
	docker compose up -d

docker-down: ## 停止 Docker 容器
	docker compose down

docker-logs: ## 查看 Docker 日志
	docker compose logs -f

install: ## 安装依赖
	@echo "📦 安装依赖..."
	@cd server && npm install
	@cd crawler && uv sync
	@cd tests/e2e && npm install
	@echo "✅ 依赖安装完成!"

init: install docker-up db-migrate seed ## 初始化项目(首次运行)
	@echo "✅ 项目初始化完成! 运行 'make dev' 启动开发服务器"
