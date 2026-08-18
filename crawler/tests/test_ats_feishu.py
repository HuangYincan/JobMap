# Feishu jobs ATS adapter tests.
# Fixtures: feishu-nio.min.html is trimmed from the live 2026-08-19 sample
# (nio.jobs.feishu.cn); feishu-search-job.sample.json follows the documented
# search_job response shape (live validation pending pilot — feishu-ats.md).

import json
import unittest
from pathlib import Path

from domain_map_importer import ats_feishu
from domain_map_importer.acquire import PoliteFetcher
from domain_map_importer.official_refresh import refresh_company_from_source

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE_HTML = (FIXTURES / "feishu-nio.min.html").read_text(encoding="utf-8")
PAGE1 = json.loads((FIXTURES / "feishu-search-job.sample.json").read_text(encoding="utf-8"))
PAGE2 = {
    "code": 0,
    "data": {
        "job_list": [
            {
                "id": "759213000000000003",
                "title": "测试工程师",
                "description": "<p>质量保障</p>",
                "apply_url": "https://nio.jobs.feishu.cn/759213000000000003",
                "recruit_type": "social",
            }
        ],
        "page_token": "",
        "has_more": False,
    },
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

    def __call__(self, url):
        self.urls.append(url)
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
        jobs, token, has_more = ats_feishu.parse_page(PAGE1)
        self.assertEqual(len(jobs), 2)
        self.assertEqual(token, "next-page-token")
        self.assertTrue(has_more)

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
        position = ats_feishu.job_to_position(PAGE1["data"]["job_list"][0], "nio-site", "2026-08-19T00:00:00Z")
        self.assertEqual(position["externalId"], "feishu-759213000000000001")
        self.assertEqual(position["title"], "高级前端开发工程师")
        self.assertEqual(position["siteId"], "nio-site")
        self.assertEqual(position["family"], "social")
        self.assertEqual(position["taxonomy"], {"family": "social"})
        self.assertEqual(position["status"], "open")
        self.assertEqual(position["applySource"], "official")
        self.assertEqual(position["applyUrl"], "https://nio.jobs.feishu.cn/759213000000000001")
        self.assertIn("地图应用前端架构", position["description"])
        self.assertNotIn("<p>", position["description"])

    def test_family_from_recruit_type_and_title_fallback(self):
        campus = {"id": "2", "title": "算法工程师", "recruit_type": "campus"}
        intern = {"id": "3", "title": "前端实习生", "recruit_type": "intern"}
        by_title = {"id": "4", "title": "社招-后端工程师"}
        self.assertEqual(ats_feishu.job_to_position(campus, "s", "t")["family"], "campus")
        self.assertEqual(ats_feishu.job_to_position(intern, "s", "t")["family"], "intern")
        self.assertEqual(ats_feishu.job_to_position(by_title, "s", "t")["family"], "social")

    def test_missing_id_raises(self):
        with self.assertRaises(ats_feishu.AdapterError):
            ats_feishu.job_to_position({"title": "无 id"}, "s", "t")


class PaginationTests(unittest.TestCase):
    def test_fetches_all_pages_with_page_token(self):
        fetcher = make_fetcher([(200, json.dumps(PAGE1)), (200, json.dumps(PAGE2))])
        jobs, errors = ats_feishu.fetch_all_jobs(fetcher, "nio.jobs.feishu.cn")
        self.assertEqual(len(jobs), 3)
        self.assertEqual(errors, [])
        api_urls = [u for u in fetcher._get.urls if "/api/" in u]
        self.assertEqual(len(api_urls), 2)
        self.assertIn("page_token=next-page-token", api_urls[1])
        self.assertIn("page_size=20", api_urls[0])

    def test_stops_on_api_error_code(self):
        fetcher = make_fetcher([(200, json.dumps({"code": 9, "message": "boom"}))])
        jobs, errors = ats_feishu.fetch_all_jobs(fetcher, "nio.jobs.feishu.cn")
        self.assertEqual(jobs, [])
        self.assertEqual(len(errors), 1)
        self.assertIn("code=9", errors[0]["error"])

    def test_degrades_on_non_json(self):
        fetcher = make_fetcher([(200, "<html>challenge page</html>")])
        jobs, errors = ats_feishu.fetch_all_jobs(fetcher, "nio.jobs.feishu.cn")
        self.assertEqual(jobs, [])
        self.assertEqual(errors[0]["error"], "non-JSON response body")


class SourceRoutingTests(unittest.TestCase):
    def test_feishu_host_uses_api_and_merges_positions(self):
        fetcher = make_fetcher([(200, json.dumps(PAGE1)), (200, json.dumps(PAGE2))])
        refreshed, meta = refresh_company_from_source(COMPANY, fetcher, SAMPLE_HTML, "https://nio.jobs.feishu.cn/")
        self.assertEqual(meta["source"], "feishu-api")
        self.assertEqual(meta["api_jobs"], 3)
        ids = {p["externalId"] for p in refreshed["positions"]}
        self.assertEqual(ids, {"feishu-759213000000000001", "feishu-759213000000000002", "feishu-759213000000000003"})
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
        first, _ = refresh_company_from_source(COMPANY, make_fetcher(list(responses)), SAMPLE_HTML, "https://nio.jobs.feishu.cn/")
        second, meta = refresh_company_from_source(first, make_fetcher(list(responses)), SAMPLE_HTML, "https://nio.jobs.feishu.cn/")
        self.assertEqual(meta["api_jobs"], 3)
        self.assertEqual(len(second["positions"]), 3)  # no duplicates


if __name__ == "__main__":
    unittest.main()
