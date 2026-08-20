# Zhiye (Beisen italent *.zhiye.com) ATS adapter tests.
# Fixtures simulate the three probe steps from tech/roles/data/etl/zhiye-ats.md:
#   1. portal shell HTML → BSGlobal config + SPA bundle URL (zhiye-iflytek.min.html)
#   2. bundle JS → quoted /api/* candidates (zhiye-bundle.min.js, synthetic)
#   3. API page payload → job list contract (zhiye-jobs.sample.json)
# No network: every request goes through PoliteFetcher with a FakeGet.
# NOTE: the API paths in the bundle fixture are placeholders — the live probe
# (boss Env) locks the real endpoint; until then the contract is what this
# parser accepts (zhiye-ats.md 校准点).

import json
import unittest
from pathlib import Path

from domain_map_importer import ats_zhiye
from domain_map_importer.acquire import PoliteFetcher

FIXTURES = Path(__file__).parent / "fixtures"
PORTAL_HTML = (FIXTURES / "zhiye-iflytek.min.html").read_text(encoding="utf-8")
BUNDLE_JS = (FIXTURES / "zhiye-bundle.min.js").read_text(encoding="utf-8")
PAGE_JSON = json.loads((FIXTURES / "zhiye-jobs.sample.json").read_text(encoding="utf-8"))

SPECIFIC_JOB = {
    "jobId": "JOB-2026-0001",
    "title": "算法工程师(语音方向)",
    "cityName": "上海",
    "workType": "全职",
    "description": "<p>负责语音大模型核心算法研发。</p>",
    "requirement": "硕士及以上",
}
AGGREGATE_JOB = {
    "jobId": "JOB-2026-0002",
    "title": "研究算法类 研发类 AI研发类 大数据类 产品类 测试类 营销类  教育类 设计类 职能类 资源类 医学类 工程类 交付类",
    "cityName": "北京",
    "workType": "校招",
}
CAMPUS_JOB = {"jobId": "JOB-2026-0003", "title": "【27届校招】前端开发工程师", "workType": {"name": "校招"}, "cityName": "杭州"}

COMPANY = {
    "slug": "科大讯飞",
    "name": "科大讯飞",
    "industries": ["internet"],
    "scale": "enterprise",
    "tier": 5,
    "category": "65",
    "careerUrl": "https://iflytek.zhiye.com/campus/jobs",
    "sites": [
        {"id": "科大讯飞-site-shanghai", "name": "科大讯飞", "city": "上海市", "province": "上海市", "location": {"address": "上海市"}},
        {"id": "科大讯飞-site-beijing", "name": "科大讯飞", "city": "北京市", "province": "北京市", "location": {"address": "北京市"}},
    ],
    "positions": [],
}


class FakeGet:
    """Stand-in for urllib: 404 robots, then queued (status, body) responses."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.urls = []
        self.calls = []

    def __call__(self, url, method="GET", body=None, headers=None):
        self.urls.append(url)
        self.calls.append({"url": url, "method": method, "body": body, "headers": headers})
        if url.endswith("/robots.txt"):
            return 404, ""
        if not self.responses:
            return 500, ""
        return self.responses.pop(0)


def make_fetcher(responses, interval=0.0):
    return PoliteFetcher(min_interval_s=interval, sleep=lambda seconds: None, get=FakeGet(responses))


class ConfigParsingTests(unittest.TestCase):
    def test_parse_bs_global_from_sample_html(self):
        bs = ats_zhiye.parse_bs_global(PORTAL_HTML)
        self.assertIsNotNone(bs)
        self.assertEqual(ats_zhiye.tenant_domain(bs), "iflytek")
        self.assertEqual(ats_zhiye.portal_id(bs), "6e2235dc-4b88-4698-b96a-5a73c705d8db")

    def test_parse_bs_global_missing_or_malformed(self):
        self.assertIsNone(ats_zhiye.parse_bs_global("<html><body>no config</body></html>"))
        self.assertIsNone(ats_zhiye.parse_bs_global("<script>var BSGlobal = {not json};</script>"))

    def test_portal_base_url_derives_tenant_domain(self):
        bs = ats_zhiye.parse_bs_global(PORTAL_HTML)
        self.assertEqual(ats_zhiye.portal_base_url(bs), "https://iflytek.zhiye.com")
        # 无 tenantInfo.Domain 时回退 careerUrl host
        self.assertEqual(ats_zhiye.portal_base_url({}, "iflytek.zhiye.com"), "https://iflytek.zhiye.com")
        self.assertEqual(ats_zhiye.portal_base_url({}, ""), "")

    def test_bundle_url_from_sample_html(self):
        bs = ats_zhiye.parse_bs_global(PORTAL_HTML)
        self.assertEqual(
            ats_zhiye.bundle_url(bs, PORTAL_HTML),
            "https://acdn.bstatics.com/ux/ux-recruitment-portal-2022/release/dist/pc-ef703ae29522fd7fa535.chunk.min.js",
        )

    def test_bundle_url_protocol_relative_without_static_path(self):
        html = '<script src="//cdn.example.com/ux/ux-recruitment-portal-2022/release/dist/pc-abc123.chunk.min.js"></script>'
        self.assertEqual(
            ats_zhiye.bundle_url({}, html),
            "https://cdn.example.com/ux/ux-recruitment-portal-2022/release/dist/pc-abc123.chunk.min.js",
        )

    def test_bundle_url_missing(self):
        self.assertIsNone(ats_zhiye.bundle_url({}, "<html></html>"))

    def test_host_routing(self):
        self.assertTrue(ats_zhiye.is_zhiye_host("iflytek.zhiye.com"))
        self.assertTrue(ats_zhiye.is_zhiye_host("zhiye.com"))
        self.assertFalse(ats_zhiye.is_zhiye_host("talent.alibaba.com"))
        self.assertFalse(ats_zhiye.is_zhiye_host(""))


class BundleProbeTests(unittest.TestCase):
    def test_extract_api_paths_filters_plumbing(self):
        paths = ats_zhiye.extract_api_paths(BUNDLE_JS)
        # login/upload 过滤;顺序保持;去重
        self.assertEqual(
            paths,
            ["/api/portal/job/list", "/api/portal/job/detail", "/api/portal/recruit/position/list"],
        )

    def test_extract_api_paths_dedupes_and_drops_query(self):
        bundle = 'var a="/api/portal/job/list",b="/api/portal/job/list?x=1";'
        self.assertEqual(ats_zhiye.extract_api_paths(bundle), ["/api/portal/job/list"])

    def test_job_candidates_keeps_job_hints_only(self):
        self.assertEqual(
            ats_zhiye.job_candidates(["/api/user/login", "/api/portal/job/list", "/api/upload"]),
            ["/api/portal/job/list"],
        )

    def test_probe_endpoint_finds_job_payload(self):
        fetcher = make_fetcher([(200, json.dumps(PAGE_JSON))])
        endpoint = ats_zhiye.probe_endpoint(fetcher, "https://iflytek.zhiye.com", ats_zhiye.extract_api_paths(BUNDLE_JS), "pid-1")
        self.assertEqual(endpoint, "https://iflytek.zhiye.com/api/portal/job/list")
        api_calls = [c for c in fetcher._get.calls if "/api/" in c["url"]]
        self.assertEqual(len(api_calls), 1)
        self.assertEqual(api_calls[0]["method"], "GET")
        self.assertIn("portalId=pid-1", api_calls[0]["url"])

    def test_probe_skips_wrong_shape_payload(self):
        # 第一个候选返回非岗位 JSON → 跳过,第二个候选命中
        noise = json.dumps({"code": 0, "data": {}})
        fetcher = make_fetcher([(200, noise), (200, json.dumps(PAGE_JSON))])
        endpoint = ats_zhiye.probe_endpoint(fetcher, "https://iflytek.zhiye.com", ats_zhiye.extract_api_paths(BUNDLE_JS), "pid-1")
        self.assertEqual(endpoint, "https://iflytek.zhiye.com/api/portal/job/detail")

    def test_probe_rejects_non_job_rows(self):
        # list 存在但行不是岗位(无 id/title)→ 继续下一个候选
        noise = json.dumps({"code": 0, "data": {"list": [{"nav": "x"}], "total": 1}})
        fetcher = make_fetcher([(200, noise), (200, json.dumps(PAGE_JSON))])
        endpoint = ats_zhiye.probe_endpoint(fetcher, "https://iflytek.zhiye.com", ats_zhiye.extract_api_paths(BUNDLE_JS), "pid-1")
        self.assertEqual(endpoint, "https://iflytek.zhiye.com/api/portal/job/detail")

    def test_probe_falls_back_to_post_on_non_json(self):
        # GET 返回 HTML 壳 → 同一路径 POST;POST 命中
        html_shell = "<html><body>app shell</body></html>"
        fetcher = make_fetcher([(200, html_shell), (200, json.dumps(PAGE_JSON))])
        endpoint = ats_zhiye.probe_endpoint(fetcher, "https://iflytek.zhiye.com", ["/api/portal/job/list"], "pid-1")
        self.assertEqual(endpoint, "https://iflytek.zhiye.com/api/portal/job/list")
        api_calls = [c for c in fetcher._get.calls if "/api/" in c["url"]]
        self.assertEqual(api_calls[0]["method"], "GET")
        self.assertEqual(api_calls[1]["method"], "POST")
        self.assertIn('"portalId": "pid-1"', api_calls[1]["body"])

    def test_probe_no_candidates_raises(self):
        fetcher = make_fetcher([])
        with self.assertRaises(ats_zhiye.AdapterError):
            ats_zhiye.probe_endpoint(fetcher, "https://iflytek.zhiye.com", [], "pid-1")


class PayloadParsingTests(unittest.TestCase):
    def test_parse_jobs_payload_full_shape(self):
        jobs, total = ats_zhiye.parse_jobs_payload(PAGE_JSON)
        self.assertEqual(len(jobs), 2)
        self.assertEqual(total, 2)

    def test_parse_jobs_payload_aliases(self):
        payload = {"code": 0, "data": {"jobs": [SPECIFIC_JOB], "count": 1}}
        jobs, total = ats_zhiye.parse_jobs_payload(payload)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(total, 1)
        payload = {"code": 0, "data": {"records": [SPECIFIC_JOB], "totalCount": 1}}
        jobs, total = ats_zhiye.parse_jobs_payload(payload)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(total, 1)

    def test_parse_jobs_payload_bare_data_list(self):
        jobs, total = ats_zhiye.parse_jobs_payload({"code": 0, "data": [SPECIFIC_JOB]})
        self.assertEqual(len(jobs), 1)
        self.assertEqual(total, 1)

    def test_parse_jobs_payload_error_code(self):
        with self.assertRaises(ats_zhiye.AdapterError) as ctx:
            ats_zhiye.parse_jobs_payload({"code": 1001, "message": "rate limited"})
        self.assertIn("1001", str(ctx.exception))

    def test_parse_jobs_payload_missing_list(self):
        with self.assertRaises(ats_zhiye.AdapterError):
            ats_zhiye.parse_jobs_payload({"code": 0, "data": {}})
        with self.assertRaises(ats_zhiye.AdapterError):
            ats_zhiye.parse_jobs_payload("not json")

    def test_parse_jobs_payload_empty_list_is_valid(self):
        jobs, total = ats_zhiye.parse_jobs_payload({"code": 0, "data": {"list": [], "total": 0}})
        self.assertEqual((jobs, total), ([], 0))


class PositionMappingTests(unittest.TestCase):
    def test_maps_all_fields(self):
        position = ats_zhiye.job_to_position(SPECIFIC_JOB, "科大讯飞-site-shanghai", "2026-08-20T00:00:00Z")
        self.assertEqual(position["externalId"], "portal-zhiye-JOB-2026-0001")
        self.assertEqual(position["title"], "算法工程师(语音方向)")
        self.assertEqual(position["siteId"], "科大讯飞-site-shanghai")
        self.assertEqual(position["family"], "social")  # workType 全职 → social
        self.assertEqual(position["taxonomy"], {"family": "social"})
        self.assertEqual(position["status"], "open")
        self.assertEqual(position["applySource"], "official")
        self.assertEqual(position["applyUrl"], "")  # 行无 url → fallback 未传
        self.assertEqual(position["retrievedAt"], "2026-08-20T00:00:00Z")
        self.assertIn("负责语音大模型核心算法研发。", position["description"])
        self.assertIn("岗位要求:", position["description"])
        self.assertNotIn("<p>", position["description"])
        self.assertNotIn("aggregate", position)

    def test_aggregate_title_marked(self):
        # 聚合/多岗位打包行 → aggregate: True(与 radar 同启发式)
        position = ats_zhiye.job_to_position(AGGREGATE_JOB, "s", "t")
        self.assertTrue(position.get("aggregate"))
        self.assertEqual(position["family"], "campus")  # workType 校招 → campus

    def test_family_from_nested_work_type_and_title_fallback(self):
        campus = ats_zhiye.job_to_position(CAMPUS_JOB, "s", "t")
        self.assertEqual(campus["family"], "campus")
        intern = {"jobId": "1", "title": "前端实习生", "workType": "实习"}
        self.assertEqual(ats_zhiye.job_to_position(intern, "s", "t")["family"], "intern")
        by_title = {"jobId": "2", "title": "社招-后端工程师", "workType": {}}
        self.assertEqual(ats_zhiye.job_to_position(by_title, "s", "t")["family"], "social")

    def test_missing_id_raises(self):
        with self.assertRaises(ats_zhiye.AdapterError):
            ats_zhiye.job_to_position({"title": "无 id"}, "s", "t")
        with self.assertRaises(ats_zhiye.AdapterError):
            ats_zhiye.job_to_position({"jobId": "1"}, "s", "t")

    def test_apply_url_relative_and_fallback(self):
        job = {"jobId": "1", "title": "t", "url": "/job/1"}
        self.assertEqual(ats_zhiye.job_to_position(job, "s", "t", base_url="https://iflytek.zhiye.com")["applyUrl"], "https://iflytek.zhiye.com/job/1")
        job2 = {"jobId": "2", "title": "t"}
        self.assertEqual(ats_zhiye.job_to_position(job2, "s", "t", fallback_url="https://iflytek.zhiye.com/campus/jobs")["applyUrl"], "https://iflytek.zhiye.com/campus/jobs")

    def test_job_city(self):
        self.assertEqual(ats_zhiye.job_city(SPECIFIC_JOB), "上海")
        self.assertEqual(ats_zhiye.job_city({"jobId": "1", "title": "t", "location": "上海市浦东新区"}), "上海市")
        # 英文地址行不当城市
        self.assertEqual(ats_zhiye.job_city({"jobId": "1", "title": "t", "location": "Building 5, Beijing"}), "")
        self.assertEqual(ats_zhiye.job_city({"jobId": "1", "title": "t"}), "")

    def test_site_id_matches_company_site_by_city(self):
        self.assertEqual(ats_zhiye.site_id_for_job(COMPANY, SPECIFIC_JOB), "科大讯飞-site-shanghai")
        unknown = {"jobId": "1", "title": "t", "cityName": "火星"}
        self.assertEqual(ats_zhiye.site_id_for_job(COMPANY, unknown), "科大讯飞-site-shanghai")

    def test_jobs_to_positions_skips_malformed_rows(self):
        jobs = [SPECIFIC_JOB, {"title": "缺 id"}]
        positions = ats_zhiye.jobs_to_positions(jobs, COMPANY, "t")
        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0]["externalId"], "portal-zhiye-JOB-2026-0001")

    def test_ensure_city_sites_appends_only_new_cities(self):
        company = json.loads(json.dumps(COMPANY))
        jobs = [SPECIFIC_JOB, CAMPUS_JOB, {"jobId": "x", "title": "t", "cityName": "合肥"}]
        ats_zhiye.ensure_city_sites(company, jobs)
        ids = {site["id"] for site in company["sites"]}
        self.assertEqual(ids, {"科大讯飞-site-shanghai", "科大讯飞-site-beijing", "科大讯飞-site-hangzhou", "科大讯飞-site-合肥"})
        hangzhou = next(s for s in company["sites"] if s["id"] == "科大讯飞-site-hangzhou")
        self.assertEqual(hangzhou["city"], "杭州市")
        self.assertEqual(hangzhou["province"], "浙江省")


class CrawlTests(unittest.TestCase):
    def test_crawl_company_full_flow(self):
        fetcher = make_fetcher([(200, PORTAL_HTML), (200, BUNDLE_JS), (200, json.dumps(PAGE_JSON)), (200, json.dumps(PAGE_JSON))])
        drop, meta = ats_zhiye.crawl_company(fetcher, COMPANY)
        self.assertEqual(meta["source"], "zhiye-api")
        self.assertEqual(meta["api_jobs"], 2)
        self.assertEqual(meta["api_errors"], [])
        self.assertEqual(drop["slug"], "科大讯飞")
        self.assertEqual(drop["source"], "zhiye-ats")
        self.assertEqual(drop["careerUrl"], COMPANY["careerUrl"])
        ids = {p["externalId"] for p in drop["positions"]}
        self.assertEqual(ids, {"portal-zhiye-JOB-2026-0001", "portal-zhiye-JOB-2026-0002"})
        by_id = {p["externalId"]: p for p in drop["positions"]}
        self.assertEqual(by_id["portal-zhiye-JOB-2026-0002"].get("aggregate"), True)
        # curated 站点保留,无新城市
        site_ids = {s["id"] for s in drop["sites"]}
        self.assertEqual(site_ids, {"科大讯飞-site-shanghai", "科大讯飞-site-beijing"})

    def test_crawl_company_paginates_until_total(self):
        page1 = {"code": 0, "data": {"list": [SPECIFIC_JOB, CAMPUS_JOB], "total": 3}}
        page2 = {"code": 0, "data": {"list": [AGGREGATE_JOB], "total": 3}}
        fetcher = make_fetcher([(200, PORTAL_HTML), (200, BUNDLE_JS), (200, json.dumps(page1)), (200, json.dumps(page1)), (200, json.dumps(page2))])
        drop, meta = ats_zhiye.crawl_company(fetcher, COMPANY)
        self.assertEqual(meta["api_jobs"], 3)
        self.assertEqual(len(drop["positions"]), 3)
        api_calls = [c for c in fetcher._get.calls if "/api/" in c["url"]]
        self.assertEqual(len(api_calls), 3)  # 探针 1 + 分页 2
        self.assertIn("page=2", api_calls[2]["url"])

    def test_crawl_company_portal_failure_surfaces_errors(self):
        fetcher = make_fetcher([(500, "")])
        drop, meta = ats_zhiye.crawl_company(fetcher, COMPANY)
        self.assertEqual(meta["api_jobs"], 0)
        self.assertTrue(meta["api_errors"])
        self.assertIn("http 500", meta["api_errors"][0]["error"])
        self.assertEqual(drop["positions"], [])

    def test_crawl_company_robots_blocked(self):
        def fake(url, method="GET", body=None, headers=None):
            if url.endswith("/robots.txt"):
                return 200, "User-agent: *\nDisallow: /\n"
            return 200, "unreachable"
        fetcher = PoliteFetcher(min_interval_s=0, sleep=lambda s: None, get=fake)
        drop, meta = ats_zhiye.crawl_company(fetcher, COMPANY)
        self.assertEqual(meta["api_jobs"], 0)
        self.assertIn("portal blocked", meta["api_errors"][0]["error"])
        self.assertEqual(drop["positions"], [])

    def test_crawl_company_rejects_non_zhiye_host(self):
        company = {**COMPANY, "careerUrl": "https://talent.example.com/"}
        fetcher = make_fetcher([])
        drop, meta = ats_zhiye.crawl_company(fetcher, company)
        self.assertIn("not a zhiye host", meta["api_errors"][0]["error"])
        self.assertEqual(drop["positions"], [])

    def test_crawl_company_empty_pool_no_crash(self):
        empty = {"code": 0, "data": {"list": [], "total": 0}}
        fetcher = make_fetcher([(200, PORTAL_HTML), (200, BUNDLE_JS), (200, json.dumps(empty)), (200, json.dumps(empty))])
        drop, meta = ats_zhiye.crawl_company(fetcher, COMPANY)
        self.assertEqual(meta["api_errors"], [])
        self.assertEqual(meta["api_jobs"], 0)
        self.assertEqual(drop["positions"], [])

    def test_crawl_company_missing_bundle_reports_error(self):
        html = PORTAL_HTML.replace('src="//acdn.bstatics.com/ux/ux-recruitment-portal-2022/release/dist/pc-ef703ae29522fd7fa535.chunk.min.js"', "")
        fetcher = make_fetcher([(200, html)])
        drop, meta = ats_zhiye.crawl_company(fetcher, COMPANY)
        self.assertIn("no 2022 portal SPA bundle", meta["api_errors"][0]["error"])


if __name__ == "__main__":
    unittest.main()
