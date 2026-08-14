# 测试指南

## 测试策略

Domain Map Platform 采用多层测试策略,确保代码质量和系统稳定性。

## 测试金字塔

```
        /\
       /  \  E2E 测试(关键流程)
      /____\
     /      \  集成测试(API/数据库)
    /________\
   /          \  单元测试(逻辑/组件)
  /____________\
```

**目标覆盖率**:
- 单元测试:> 80%
- 集成测试:> 60%
- E2E 测试:核心流程 100%

## 目录结构

```
tests/
├── README.md                # 本文档
├── fixtures/                # 测试数据
│   ├── companies.json
│   ├── jobs.json
│   └── user_profiles.json
├── unit/                    # 单元测试
│   ├── backend/             # Python 单测(pytest)
│   │   ├── test_strength_score.py
│   │   ├── test_recommendation.py
│   │   └── test_geocode.py
│   └── frontend/            # TypeScript 单测(Jest + RTL)
│       ├── components/
│       │   ├── MapView.test.tsx
│       │   └── EntityCard.test.tsx
│       └── lib/
│           ├── queries.test.ts
│           └── plugins.test.ts
├── integration/             # 集成测试
│   ├── api/
│   │   ├── test_maps_api.ts
│   │   ├── test_entities_api.ts
│   │   └── test_spatial_api.ts
│   └── db/
│       ├── test_postgis.py
│       └── test_migrations.sh
├── e2e/                     # 端到端测试(Playwright)
│   ├── playwright.config.ts
│   ├── fixtures.ts
│   └── specs/
│       ├── user-journey.spec.ts      # 完整用户旅程
│       ├── search-and-view.spec.ts   # 搜索+查看 POI
│       ├── profile-upload.spec.ts    # 简历上传
│       └── recommendation.spec.ts    # 推荐列表
├── performance/             # 性能测试(Locust)
│   ├── locustfile.py
│   └── scenarios/
│       ├── bbox_query.py
│       └── spatial_search.py
├── security/                # 安全测试
│   ├── sql_injection.test.ts
│   ├── xss.test.ts
│   └── auth.test.ts
└── smoke/                   # 冒烟测试(< 2min)
    └── smoke.sh
```

## 运行测试

### 全部测试
```bash
make test              # 单元 + 集成测试
make test-e2e          # E2E 测试
make test-all          # 所有测试
```

### 单独运行

**前端单元测试**(Jest):
```bash
cd server
npm run test
npm run test:watch     # 监听模式
npm run test:coverage  # 生成覆盖率报告
```

**后端单元测试**(pytest):
```bash
cd crawler
uv run pytest tests/unit/backend/
uv run pytest --cov=app tests/  # 覆盖率报告
```

**集成测试**:
```bash
cd tests/integration
npm run test:integration
```

**E2E 测试**(Playwright):
```bash
cd tests/e2e
npx playwright test
npx playwright test --ui          # UI 模式
npx playwright test --debug       # 调试模式
```

**性能测试**(Locust):
```bash
cd tests/performance
locust -f locustfile.py --host=http://localhost:3000
```

## 编写测试

### 单元测试示例(前端)

```typescript
// tests/unit/frontend/lib/queries.test.ts
import { describe, it, expect } from '@jest/globals';
import { calculateDistance } from '@/lib/queries';

describe('calculateDistance', () => {
  it('should calculate correct distance between two points', () => {
    const p1 = { lng: 120.0, lat: 30.0 };
    const p2 = { lng: 120.1, lat: 30.1 };
    const dist = calculateDistance(p1, p2);
    expect(dist).toBeCloseTo(15.7, 1);  // ~15.7 km
  });
});
```

### 集成测试示例(API)

```typescript
// tests/integration/api/test_entities_api.ts
import { describe, it, expect } from '@jest/globals';

describe('GET /api/entities', () => {
  it('should return entities within bbox', async () => {
    const res = await fetch('http://localhost:3000/api/entities?bbox=120.0,30.0,120.2,30.2&domain=recruitment');
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.entities).toBeInstanceOf(Array);
    expect(data.entities[0]).toHaveProperty('name');
  });
});
```

### E2E 测试示例(Playwright)

```typescript
// tests/e2e/specs/search-and-view.spec.ts
import { test, expect } from '@playwright/test';

test('用户搜索公司并查看详情', async ({ page }) => {
  // 访问首页
  await page.goto('http://localhost:3000');
  
  // 搜索"字节跳动"
  await page.fill('[data-testid="search-box"]', '字节跳动');
  await page.click('[data-testid="search-button"]');
  
  // 等待地图飞行到结果
  await page.waitForTimeout(2000);
  
  // 点击 POI
  await page.click('[data-poi-id="1"]');
  
  // 验证抽屉打开
  const drawer = page.locator('[data-testid="entity-drawer"]');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('字节跳动');
  
  // 验证 JD 列表加载
  const jobList = page.locator('[data-testid="job-list"]');
  await expect(jobList.locator('.job-card')).toHaveCount(10);
});
```

## TDD 工作流

关键模块使用 TDD(测试驱动开发):

```bash
# 使用 /tdd skill
/tdd "实现用户实力评分算法"
```

流程:
1. **红**:先写测试(失败)
2. **绿**:写最少代码让测试通过
3. **重构**:优化代码,保持测试通过

## CI/CD 集成

每次 Push/PR 自动运行:

```yaml
# .github/workflows/test.yml
- Lint 检查(ESLint + Black)
- 单元测试
- 集成测试
- E2E 测试(关键流程)
- 覆盖率报告上传(Codecov)
```

详见 `.github/workflows/test.yml`

## 测试数据管理

**Fixtures**(`tests/fixtures/`):
- 手工维护的种子数据
- Git 跟踪,所有测试共享

**Factory**:
- 运行时生成测试数据
- 使用 Faker.js / factory_boy

**数据库隔离**:
- 每个测试用例独立事务
- 测试结束自动回滚

## 故障排查

**测试卡住**:
```bash
# 检查数据库是否运行
docker compose ps db

# 检查端口占用
lsof -i :3000
```

**E2E 测试失败**:
```bash
# 查看截图
open tests/e2e/test-results/
```

**覆盖率不足**:
```bash
# 生成 HTML 报告
npm run test:coverage
open coverage/index.html
```

## 最佳实践

1. **测试独立**:每个测试不依赖其他测试
2. **快速反馈**:单元测试 < 1s,集成测试 < 10s
3. **清晰命名**:`test_用户上传简历后应该解析出教育经历()`
4. **最小断言**:一个测试验证一个行为
5. **避免脆弱**:不依赖具体数值(用 `toBeCloseTo` 而非 `toBe`)

## 下一步

- 阅读 `agent.md` 的"开发过程中"章节
- 查看 `/tdd` skill 的 TDD 工作流
- 运行 `make test` 验证环境
