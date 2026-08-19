# Feishu jobs ATS adapter tests.
# Fixtures follow the REAL endpoint shape (discovered 2026-08-19 by bundle
# analysis, live-validated on agirobot/poizon/kwh0jtf778):
#   POST /api/v1/search/job/posts → {"code":0,"data":{"job_post_list":[...],"count":N}}
# The old documented GET /api/v1/search_job shape is a catch-all HTML shell —
# the fixtures here are what the real API returns.

import json
import unittest
from pathlib import Path

from domain_map_importer import ats_feishu
from domain_map_importer.acquire import PoliteFetcher
from domain_map_importer.official_refresh import refresh_company_from_source

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE_HTML = (FIXTURES / "feishu-nio.min.html").read_text(encoding="utf-8")

CAMPUS_JOB = {
    "id": "759213000000000001",
    "title": "【26届校招】前端开发工程师",
    "description": "<p>地图应用前端架构</p>",
    "requirement": "本科及以上",
    "recruit_type": {"id": "201", "name": "正式", "parent": {"id": "2", "name": "校招"}},
    "city_list": [{"name": "上海"}],
}
SOCIAL_JOB = {
    "id": "759213000000000002",
    "title": "高级后端工程师",
    "description": "<p>负责推荐系统</p>",
    "requirement": "5 年经验",
    "recruit_type": {"id": "101", "name": "全职"},
    "city_list": [{"name": "北京"}],
}
INTERN_JOB = {
    "id": "759213000000000003",
    "title": "测试实习生",
    "description": "<p>质量保障</p>",
    "recruit_type": {"name": "实习"},
    "city_list": [{"name": "杭州"}],
}

PAGE1 = {
    "code": 0,
    "data": {"job_post_list": [CAMPUS_JOB, SOCIAL_JOB], "count": 3, "extra": "{}"},
}
PAGE2 = {
    "code": 0,
    "data": {"job_post_list": [INTERN_JOB], "count": 3, "extra": "{}"},
}

COMPANY = {
    "slug": "nio",
    "name": "NIO",
    "industries": ["auto"],
    "scale": "bigtech",
    "careerUrl": "https://nio.jobs.feishu.cn/",
    "sites": [{"id": "nio-site", "name": "NIO"}],
    "positions": [],
}

JSONLD_HTML = """
<html><head><script type="application/ld+json">
{"@type": "JobPosting", "title": "算法工程师", "url": "https://talent.example.com/job/1"}
</script></head></html>
"""


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


class TenantExtractionTests(unittest.TestCase):
    def test_parse_tenant_id_from_sample_html(self):
        self.assertEqual(ats_feishu.parse_tenant_id(SAMPLE_HTML), "6982450737365485854")

    def test_parse_tenant_id_missing_script(self):
        self.assertIsNone(ats_feishu.parse_tenant_id("<html><body>no script</body></html>"))

    def test_host_routing(self):
        self.assertTrue(ats_feishu.is_feishu_jobs_host("nio.jobs.feishu.cn"))
        self.assertTrue(ats_feishu.is_feishu_jobs_host("jobs.feishu.cn"))
        self.assertFalse(ats_feishu.is_feishu_jobs_host("talent.alibaba.com"))
        self.assertFalse(ats_feishu.is_feishu_jobs_host(""))


class PageParsingTests(unittest.TestCase):
    def test_parse_page_full_shape(self):
        jobs, total = ats_feishu.parse_page(PAGE1)
        self.assertEqual(len(jobs), 2)
        self.assertEqual(total, 3)

    def test_parse_page_error_code(self):
        with self.assertRaises(ats_feishu.AdapterError) as ctx:
            ats_feishu.parse_page({"code": 1001, "message": "rate limited"})
        self.assertIn("1001", str(ctx.exception))

    def test_parse_page_missing_job_list(self):
        with self.assertRaises(ats_feishu.AdapterError):
            ats_feishu.parse_page({"code": 0, "data": {}})

    def test_clean_jd_strips_html_and_collapses(self):
        self.assertEqual(
            ats_feishu.clean_jd("<p>负责 <b>前端</b> 开发。</p><p>要求 5 年经验。</p>"),
            "负责 前端 开发。 要求 5 年经验。",
        )
        self.assertEqual(ats_feishu.clean_jd(""), "")
        self.assertEqual(ats_feishu.clean_jd(None), "")


class PositionMappingTests(unittest.TestCase):
    def test_maps_all_fields(self):
        position = ats_feishu.job_to_position(CAMPUS_JOB, "nio-site", "2026-08-19T00:00:00Z", host="nio.jobs.feishu.cn")
        self.assertEqual(position["externalId"], "portal-feishu-759213000000000001")
        self.assertEqual(position["title"], "【26届校招】前端开发工程师")
        self.assertEqual(position["siteId"], "nio-site")
        self.assertEqual(position["family"], "campus")  # 正式 + parent 校招 → campus
        self.assertEqual(position["taxonomy"], {"family": "campus"})
        self.assertEqual(position["status"], "open")
        self.assertEqual(position["applySource"], "official")
        self.assertEqual(position["applyUrl"], "https://nio.jobs.feishu.cn/position/759213000000000001/detail")
        self.assertIn("地图应用前端架构", position["description"])
        self.assertIn("岗位要求:", position["description"])
        self.assertNotIn("<p>", position["description"])

    def test_website_path_in_apply_url(self):
        position = ats_feishu.job_to_position(SOCIAL_JOB, "s", "t", host="poizon.jobs.feishu.cn", website_path="578078")
        self.assertEqual(position["applyUrl"], "https://poizon.jobs.feishu.cn/578078/position/759213000000000002/detail")

    def test_family_from_recruit_type_and_title_fallback(self):
        social = {"id": "1", "title": "运营", "recruit_type": {"name": "全职"}}
        intern = {"id": "2", "title": "前端实习生", "recruit_type": {"name": "实习"}}
        outsource = {"id": "3", "title": "物流专员", "recruit_type": {"name": "外包"}}
        by_title = {"id": "4", "title": "社招-后端工程师", "recruit_type": {}}
        self.assertEqual(ats_feishu.job_to_position(social, "s", "t")["family"], "social")
        self.assertEqual(ats_feishu.job_to_position(intern, "s", "t")["family"], "intern")
        self.assertEqual(ats_feishu.job_to_position(outsource, "s", "t")["family"], "social")
        self.assertEqual(ats_feishu.job_to_position(by_title, "s", "t")["family"], "social")

    def test_missing_id_raises(self):
        with self.assertRaises(ats_feishu.AdapterError):
            ats_feishu.job_to_position({"title": "无 id"}, "s", "t")

    def test_job_addresses_extracts_ats_office(self):
        # 2026-08-19: ATS address_list 提供精确办公地址(区+路+门牌),是
        # geocoding v3(5000 次/天)落点的基础 —— 城市名只有城市中心点。
        job = {
            "id": "1",
            "title": "t",
            "city_list": [{"name": "上海"}],
            "job_post_info": {
                "address_list": [
                    {"name": "黄兴路221号互联宝地T7栋一楼", "city": {"name": "上海"}, "district": {"name": "杨浦区"}},
                    {"name": "上海", "city": {"name": "上海"}},  # 纯城市名 → 跳过
                ]
            },
        }
        addrs = ats_feishu.job_addresses(job)
        self.assertEqual(addrs, [{"city": "上海", "address": "黄兴路221号互联宝地T7栋一楼", "district": "杨浦区"}])

    def test_job_addresses_empty_when_missing(self):
        self.assertEqual(ats_feishu.job_addresses({"id": "1", "title": "t"}), [])
        self.assertEqual(ats_feishu.job_addresses({"id": "1", "title": "t", "job_post_info": {}}), [])

    def test_job_city_and_site_mapping(self):
        self.assertEqual(ats_feishu.job_city(CAMPUS_JOB), "上海")
        company = {**COMPANY, "sites": [{"id": "nio-site-shanghai", "name": "NIO"}, {"id": "nio-site-beijing", "name": "NIO"}]}
        self.assertEqual(ats_feishu.site_id_for_job(company, CAMPUS_JOB), "nio-site-shanghai")
        self.assertEqual(ats_feishu.site_id_for_job(company, SOCIAL_JOB), "nio-site-beijing")
        # 未知名城市回落第一个 site
        unknown = {"id": "x", "title": "t", "recruit_type": {"name": "全职"}, "city_list": [{"name": "火星"}]}
        self.assertEqual(ats_feishu.site_id_for_job(company, unknown), "nio-site-shanghai")

    def test_city_alias_normalizes_ats_typo(self):
        # 禾赛 ATS 实测笔误:"北揽"
        self.assertEqual(ats_feishu.normalize_city("北揽"), "北京")
        self.assertEqual(ats_feishu.city_site_id("禾赛科技", "北揽"), "禾赛科技-site-beijing")


class PaginationTests(unittest.TestCase):
    def test_fetches_all_pages_with_offset(self):
        fetcher = make_fetcher([(200, json.dumps(PAGE1)), (200, json.dumps(PAGE2))])
        jobs, errors = ats_feishu.fetch_all_jobs(fetcher, "nio.jobs.feishu.cn", page_size=2)
        self.assertEqual(len(jobs), 3)
        self.assertEqual(errors, [])
        api_calls = [c for c in fetcher._get.calls if "/api/" in c["url"]]
        self.assertEqual(len(api_calls), 2)
        self.assertEqual(api_calls[0]["method"], "POST")
        self.assertEqual(api_calls[0]["headers"].get("website-path"), None)
        self.assertIn("offset=0", api_calls[0]["url"])
        self.assertIn("offset=2", api_calls[1]["url"])
        self.assertIn('"offset": 2', api_calls[1]["body"])
        self.assertEqual(json.loads(api_calls[1]["body"])["limit"], 2)

    def test_website_path_header_sent(self):
        fetcher = make_fetcher([(200, json.dumps(PAGE1)), (200, json.dumps(PAGE2))])
        jobs, errors = ats_feishu.fetch_all_jobs(fetcher, "poizon.jobs.feishu.cn", website_path="578078", page_size=2)
        self.assertEqual(len(jobs), 3)
        api_calls = [c for c in fetcher._get.calls if "/api/" in c["url"]]
        self.assertEqual(api_calls[0]["headers"].get("website-path"), "578078")

    def test_stops_on_api_error_code(self):
        fetcher = make_fetcher([(200, json.dumps({"code": 9, "message": "boom"}))])
        jobs, errors = ats_feishu.fetch_all_jobs(fetcher, "nio.jobs.feishu.cn", page_size=2)
        self.assertEqual(jobs, [])
        self.assertEqual(len(errors), 1)
        self.assertIn("code=9", errors[0]["error"])

    def test_degrades_on_non_json(self):
        fetcher = make_fetcher([(200, "<html>challenge page</html>")])
        jobs, errors = ats_feishu.fetch_all_jobs(fetcher, "nio.jobs.feishu.cn", page_size=2)
        self.assertEqual(jobs, [])
        self.assertEqual(errors[0]["error"], "non-JSON response body")


class SourceRoutingTests(unittest.TestCase):
    def test_feishu_host_uses_api_and_merges_positions(self):
        fetcher = make_fetcher([(200, json.dumps(PAGE1)), (200, json.dumps(PAGE2))])
        refreshed, meta = refresh_company_from_source(COMPANY, fetcher, SAMPLE_HTML, "https://nio.jobs.feishu.cn/", page_size=2)
        self.assertEqual(meta["source"], "feishu-api")
        self.assertEqual(meta["api_jobs"], 3)
        ids = {p["externalId"] for p in refreshed["positions"]}
        self.assertEqual(ids, {"portal-feishu-759213000000000001", "portal-feishu-759213000000000002", "portal-feishu-759213000000000003"})
        with_desc = [p for p in refreshed["positions"] if p.get("description")]
        self.assertEqual(len(with_desc), 3)

    def test_api_failure_falls_back_to_html_path(self):
        fetcher = make_fetcher([(500, "")])
        refreshed, meta = refresh_company_from_source(COMPANY, fetcher, SAMPLE_HTML, "https://nio.jobs.feishu.cn/")
        self.assertEqual(meta["source"], "html")
        self.assertTrue(meta["api_errors"])
        self.assertEqual(refreshed["positions"], [])  # sample HTML carries no jobs

    def test_non_feishu_host_uses_html_only(self):
        company = {**COMPANY, "careerUrl": "https://talent.example.com/"}
        fetcher = make_fetcher([])
        refreshed, meta = refresh_company_from_source(company, fetcher, JSONLD_HTML, "https://talent.example.com/")
        self.assertEqual(meta["source"], "html")
        self.assertEqual(meta["api_errors"], [])
        self.assertEqual(refreshed["positions"][0]["externalId"], "web-算法工程师")

    def test_dedupe_across_refresh(self):
        # Each CLI run creates its own PoliteFetcher, so a re-run of the same
        # company uses a fresh fetcher (fresh responses) against the already
        # merged company.
        responses = [(200, json.dumps(PAGE1)), (200, json.dumps(PAGE2))]
        first, _ = refresh_company_from_source(COMPANY, make_fetcher(list(responses)), SAMPLE_HTML, "https://nio.jobs.feishu.cn/", page_size=2)
        second, meta = refresh_company_from_source(first, make_fetcher(list(responses)), SAMPLE_HTML, "https://nio.jobs.feishu.cn/", page_size=2)
        self.assertEqual(meta["api_jobs"], 3)
        self.assertEqual(len(second["positions"]), 3)  # no duplicates


if __name__ == "__main__":
    unittest.main()
