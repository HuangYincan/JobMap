import unittest

from domain_map_importer import (
    AcquisitionError,
    PoliteFetcher,
    extract_jobs,
    is_blocked_host,
    map_radar_job,
    merge_radar_companies,
    parse_robots,
    radar_fixture,
    refresh_company_from_html,
    validate_local_fixture,
)


class RobotsAndHostTests(unittest.TestCase):
    def test_blocks_aggregator_hosts(self):
        self.assertTrue(is_blocked_host("https://www.zhipin.com/job_detail/1.html"))
        self.assertTrue(is_blocked_host("https://www.nowcoder.com/jobs"))
        self.assertTrue(is_blocked_host("https://www.shixiseng.com/intern"))
        self.assertTrue(is_blocked_host("https://www.xiaohongshu.com/explore"))
        self.assertFalse(is_blocked_host("https://jobs.bytedance.com/campus"))

    def test_robots_longest_match_wins(self):
        robots = "User-agent: *\nDisallow: /\nAllow: /campus\n"
        self.assertTrue(parse_robots(robots, "/campus/position"))
        self.assertFalse(parse_robots(robots, "/referral"))

    def test_fetcher_refuses_blocked_hosts_before_http(self):
        def boom(_url):
            raise AssertionError("must not fetch")
        fetcher = PoliteFetcher(min_interval_s=0, sleep=lambda _s: None, get=boom)
        with self.assertRaises(AcquisitionError):
            fetcher.fetch("https://www.zhipin.com/web/geek/job")

    def test_fetcher_skips_when_robots_disallow(self):
        def fake(url):
            if url.endswith("robots.txt"):
                return 200, "User-agent: *\nDisallow: /\n"
            raise AssertionError("page must not be fetched")
        fetcher = PoliteFetcher(min_interval_s=0, sleep=lambda _s: None, get=fake)
        result = fetcher.fetch("https://jobs.example.com/secret")
        self.assertEqual(result.blocked_by, "robots.txt")
        self.assertEqual(result.body, "")


class HtmlExtractTests(unittest.TestCase):
    def test_prefers_jsonld_jobposting(self):
        html = '''
        <script type="application/ld+json">
        {"@type":"JobPosting","title":"前端开发工程师","url":"https://jobs.example.com/fe"}
        </script>
        <a href="/about">关于我们</a>
        '''
        jobs = extract_jobs(html, "https://jobs.example.com/")
        self.assertEqual(jobs[0]["title"], "前端开发工程师")
        self.assertEqual(jobs[0]["kind"], "jsonld")

    def test_falls_back_to_joblike_links(self):
        html = '<a href="/campus/fe">2026 秋招 前端工程师</a><a href="/faq">招聘流程是什么</a>'
        jobs = extract_jobs(html, "https://jobs.example.com/")
        self.assertEqual(len(jobs), 1)
        self.assertIn("前端", jobs[0]["title"])


class RadarMapTests(unittest.TestCase):
    def test_maps_hangzhou_row_and_skips_boss(self):
        hangzhou = map_radar_job({
            "c": "网易", "p": "前端开发实习生", "l": "杭州/广州",
            "ind": "互联网科技", "u": "https://hr.163.com/job/1", "w": "批次:暑期实习", "d": "招满即止",
        })
        self.assertIsNotNone(hangzhou)
        self.assertEqual(hangzhou["positions"][0]["family"], "intern")
        self.assertTrue(hangzhou["_hangzhou"])
        self.assertIsNone(map_radar_job({
            "c": "某司", "p": "Java", "l": "杭州", "u": "https://www.zhipin.com/job/1",
        }))

    def test_fixture_is_valid_local_import_and_hangzhou_only(self):
        payload = {
            "updated": "2026-08-11",
            "jobs": [
                {"c": "网易", "p": "前端", "l": "杭州", "ind": "互联网科技", "u": "https://hr.163.com/a"},
                {"c": "点点互动", "p": "市场", "l": "北京", "ind": "互联网科技", "u": "https://example.com/a"},
            ],
        }
        fixture = radar_fixture(payload)
        self.assertTrue(validate_local_fixture(fixture).valid)
        self.assertEqual(len(fixture["companies"]), 1)
        self.assertEqual(fixture["companies"][0]["name"], "网易")
        self.assertEqual(len(merge_radar_companies(payload["jobs"], hangzhou_only=False)), 2)


class OfficialRefreshTests(unittest.TestCase):
    def test_appends_new_extracted_positions(self):
        company = {
            "slug": "demo",
            "name": "Demo",
            "industries": ["internet"],
            "scale": "startup",
            "careerUrl": "https://jobs.example.com/",
            "sites": [{"id": "demo-site", "name": "Demo"}],
            "positions": [],
        }
        html = '<a href="/jobs/fe">校招 前端开发工程师</a>'
        next_company = refresh_company_from_html(company, html, "https://jobs.example.com/")
        self.assertEqual(len(next_company["positions"]), 1)
        self.assertEqual(next_company["positions"][0]["siteId"], "demo-site")
        self.assertTrue(next_company["positions"][0]["externalId"].startswith("web-"))


if __name__ == "__main__":
    unittest.main()
