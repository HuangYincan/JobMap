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

    def test_robots_agent_specific_group_precedence(self):
        robots = (
            "User-agent: *\nDisallow: /\n"
            "User-agent: DomainMapImporter\nDisallow: /private\nAllow: /\n"
        )
        # Our UA matches the specific group → /private blocked, root allowed.
        self.assertTrue(parse_robots(robots, "/"))
        self.assertFalse(parse_robots(robots, "/private"))

    def test_robots_last_duplicate_ua_group_wins(self):
        robots = (
            "User-agent: *\nDisallow: /\n"
            "User-agent: DomainMapImporter\nAllow: /\n"
            "User-agent: DomainMapImporter\nDisallow: /beta\n"
        )
        # RFC 9309 §2.2.1: the last group naming our UA applies.
        self.assertTrue(parse_robots(robots, "/"))
        self.assertFalse(parse_robots(robots, "/beta"))

    def test_robots_empty_disallow_allows(self):
        self.assertTrue(parse_robots("User-agent: *\nDisallow:\n", "/anything"))
        self.assertTrue(parse_robots("", "/anything"))

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

    def test_fetcher_survives_transient_network_errors(self):
        def fake(url):
            raise ConnectionError("SSL: UNEXPECTED_EOF_WHILE_READING")
        fetcher = PoliteFetcher(min_interval_s=0, sleep=lambda _s: None, get=fake)
        result = fetcher.fetch("https://jobs.example.com/flaky")
        self.assertEqual(result.status, 0)
        self.assertEqual(result.body, "")
        self.assertIsNone(result.blocked_by)

    def test_fetcher_tolerates_misspelled_charset(self):
        from email.message import Message
        import domain_map_importer.acquire as acquire_mod

        hdr = Message()
        hdr["Content-Type"] = "text/html; charset=uft-8"

        class FakeResp:
            status = 200
            headers = hdr
            def read(self):
                return "<html><body>hi</body></html>".encode("utf-8")
            def __enter__(self):
                return self
            def __exit__(self, *exc):
                return False

        def fake_open(_req, timeout=0):
            return FakeResp()

        original = acquire_mod.urlopen
        acquire_mod.urlopen = fake_open
        try:
            status, body = acquire_mod._http_get("https://jobs.example.com/")
            self.assertEqual(status, 200)
            self.assertIn("hi", body)
        finally:
            acquire_mod.urlopen = original


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

    def test_rejects_nav_and_javascript_links(self):
        html = (
            '<a href="/en/careers/join-tigermed">Join Tigermed</a>'
            '<a href="javascript:void(0)">校招</a>'
            '<a href="/join_us/campus">校园招聘</a>'
            '<a href="/partners">合作伙伴</a>'
        )
        jobs = extract_jobs(html, "https://jobs.example.com/")
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["url"], "https://jobs.example.com/join_us/campus")


class RadarMapTests(unittest.TestCase):
    def test_maps_hangzhou_row_and_skips_boss(self):
        hangzhou = map_radar_job({
            "c": "网易", "p": "前端开发实习生", "l": "杭州/广州",
            "ind": "互联网科技", "u": "https://hr.163.com/job/1", "w": "批次:暑期实习", "d": "招满即止",
        }, retrieved_at="2026-08-11")
        self.assertIsNotNone(hangzhou)
        self.assertEqual(hangzhou["positions"][0]["family"], "intern")
        self.assertEqual(hangzhou["positions"][0]["retrievedAt"], "2026-08-11")
        self.assertIsNone(map_radar_job({
            "c": "某司", "p": "Java", "l": "杭州", "u": "https://www.zhipin.com/job/1",
        }))

    def test_splits_per_city_sites_from_city_text(self):
        mapped = map_radar_job({
            "c": "网易游戏雷火", "p": "前端开发实习生", "l": "上海/广州/杭州", "u": "https://leihuo.163.com/job/1",
        })
        self.assertEqual(
            [site["id"] for site in mapped["sites"]],
            ["netease-hangzhou-site-shanghai", "netease-hangzhou-site-guangzhou", "netease-hangzhou-site-hangzhou"],
        )
        beijing_site, guangzhou_site, hangzhou_site = mapped["sites"]
        self.assertEqual(beijing_site["city"], "上海市")
        self.assertEqual(beijing_site["province"], "上海市")
        self.assertEqual(guangzhou_site["city"], "广州市")
        self.assertEqual(guangzhou_site["province"], "广东省")
        self.assertEqual(hangzhou_site["city"], "杭州市")
        self.assertEqual(hangzhou_site["province"], "浙江省")
        # location.address keeps the raw city text for geocode scoping.
        self.assertEqual(hangzhou_site["location"]["address"], "上海/广州/杭州")
        # No city parens in the title → the main site (first city) owns the position.
        self.assertEqual(mapped["positions"][0]["siteId"], "netease-hangzhou-site-shanghai")

    def test_drops_rows_without_a_target_city(self):
        self.assertIsNone(map_radar_job({"c": "某司", "p": "Java", "l": "南京", "u": "https://jobs.example.com/a"}))
        self.assertIsNone(map_radar_job({"c": "某司", "p": "Java", "l": "多地", "u": "https://jobs.example.com/a"}))
        self.assertIsNone(map_radar_job({"c": "某司", "p": "Java", "l": "", "u": "https://jobs.example.com/a"}))

    def test_title_city_paren_attaches_to_that_city_site(self):
        mapped = map_radar_job({
            "c": "蚂蚁集团", "p": "算法工程师（杭州）", "l": "北京/杭州", "u": "https://talent.antgroup.com/1",
        })
        self.assertEqual(mapped["positions"][0]["siteId"], "antgroup-hangzhou-site-hangzhou")

    def test_title_city_paren_falls_back_to_main_site_when_city_absent(self):
        mapped = map_radar_job({
            "c": "蚂蚁集团", "p": "算法工程师（杭州）", "l": "北京", "u": "https://talent.antgroup.com/1",
        })
        self.assertEqual(mapped["positions"][0]["siteId"], "antgroup-hangzhou-site-beijing")

    def test_title_with_multiple_city_parens_stays_on_main_site_and_is_aggregate(self):
        mapped = map_radar_job({
            "c": "网易游戏", "p": "软件实习工程师（杭州）大前端实习工程师（杭州）机器人算法实习工程师（杭州）语音算法实习工程师（杭州）软件实习工程师（深圳）大模型算法实习工程师（深圳）",
            "l": "深圳/杭州", "u": "https://leihuo.163.com/1",
        })
        self.assertEqual(mapped["positions"][0]["siteId"], "netease-hangzhou-site-shenzhen")
        self.assertTrue(mapped["positions"][0].get("aggregate"))

    def test_aggregate_title_detection(self):
        from domain_map_importer.radar_jobs import is_aggregate_title
        aggregate = [
            "技术、设计、数据、运营、产品等七大类",
            "软件类 算法类 硬件类",
            "市场类、策划类、美术类、程序类、AI技术类、运营/综合类",
            "后端/前端/嵌入式/测试研发、产品经理、解决方案、市场营销、职能、视觉交互设计等岗位全覆盖",
            "算法、软件、产品、运营、硬件等",
            "客户端/服务端开发、引擎/图形渲染、AI算法、测试开发、数据、安全、工具开发",
            "开发、测试、运营等",
            "技术类，非技术类都有",
            "算法类、软件类、",
            "技术类：算法实习生、结构实习生、嵌入式实习生、软件测试实习生\n市场类：海外市场实习生、市场营销实习生",
            "技术类 （材料 物理 化学 机械 自动化 等 ）业务/职能类 （销售/供应链/人力/行政 法务 财务等）",
            "AI 算法（NLP、计算机视觉、多模态、强化学习）、AI Infra、Agent 开发三大核心赛道",
        ]
        specific = [
            "前端开发实习生",
            "算法工程师（杭州）",
            "自动驾驶软件实习生（模型部署/量化/前后处理）",
            "无线网络设备测试实习生",
            "股权投资实习生",
            "2027顶尖人才项目启动（提前批）",
            "BEV Occupancy 算法实习生（纯视觉与多模态方向）",
        ]
        for title in aggregate:
            self.assertTrue(is_aggregate_title(title), title)
        for title in specific:
            self.assertFalse(is_aggregate_title(title), title)

    def test_aggregate_marker_and_tier_are_in_drops(self):
        mapped = map_radar_job({
            "c": "阿里淘天", "p": "技术、设计、数据、运营、产品等七大类", "l": "杭州/北京", "u": "https://talent.taotian.com/1",
        })
        self.assertEqual(mapped["tier"], 3)
        self.assertTrue(mapped["positions"][0].get("aggregate"))
        plain = map_radar_job({
            "c": "阿里淘天", "p": "前端开发工程师", "l": "杭州/北京", "u": "https://talent.taotian.com/2",
        })
        self.assertNotIn("aggregate", plain["positions"][0])

    def test_normalizes_company_names(self):
        from domain_map_importer.radar_jobs import normalize_company_name
        cases = {
            "理想汽车“理想+”计划": "理想汽车",
            "网易游戏雷火": "网易游戏雷火",
            "阿里巴巴—阿里顶尖人才计划": "阿里巴巴",
            "招商银行·招银网络科技": "招商银行",
            "！网易": "网易",
            "同花顺AIME顶尖人才计划": "同花顺AIME顶尖",
        }
        for raw, expected in cases.items():
            self.assertEqual(normalize_company_name(raw), expected, raw)

    def test_anchor_maps_netease_slugs(self):
        from domain_map_importer.radar_jobs import anchor_slug
        self.assertEqual(anchor_slug("网易游戏雷火"), "netease-hangzhou")
        self.assertEqual(anchor_slug("字节跳动Seed大模型"), "bytedance-hangzhou")
        self.assertEqual(anchor_slug("蚂蚁集团"), "antgroup-hangzhou")
        self.assertIsNone(anchor_slug("拓竹科技"))

    def test_deadline_parsing(self):
        from domain_map_importer.radar_jobs import parse_deadline
        self.assertEqual(parse_deadline("2026-10-15"), "2026-10-15")
        self.assertEqual(parse_deadline("2026 10 15"), "2026-10-15")
        self.assertEqual(parse_deadline("2026/10/15"), "2026-10-15")
        self.assertEqual(parse_deadline("2026 o6 30"), None)
        self.assertEqual(parse_deadline("招满即止"), None)
        self.assertEqual(parse_deadline(""), None)
        self.assertEqual(parse_deadline(None), None)

    def test_fixture_is_valid_local_import_and_keeps_multiple_cities(self):
        payload = {
            "updated": "2026-08-11",
            "jobs": [
                {"c": "网易", "p": "前端", "l": "杭州", "ind": "互联网科技", "u": "https://hr.163.com/a"},
                {"c": "点点互动", "p": "市场", "l": "北京", "ind": "互联网科技", "u": "https://example.com/a"},
            ],
        }
        fixture = radar_fixture(payload)
        self.assertTrue(validate_local_fixture(fixture).valid)
        # Default target set = all seven cities → both rows map.
        self.assertEqual(len(fixture["companies"]), 2)
        self.assertEqual(len(merge_radar_companies(payload["jobs"])), 2)

    def test_fixture_city_subset_filters_rows(self):
        payload = {
            "updated": "2026-08-11",
            "jobs": [
                {"c": "网易", "p": "前端", "l": "杭州", "ind": "互联网科技", "u": "https://hr.163.com/a"},
                {"c": "点点互动", "p": "市场", "l": "北京", "ind": "互联网科技", "u": "https://example.com/a"},
            ],
        }
        fixture = radar_fixture(payload, target_cities=("杭州",))
        self.assertEqual(len(fixture["companies"]), 1)
        self.assertEqual(fixture["companies"][0]["name"], "网易")

    def test_merge_unions_sites_and_positions_keeping_external_ids_unique(self):
        rows = [
            {"c": "网易", "p": "前端", "l": "杭州", "u": "https://hr.163.com/a"},
            {"c": "网易", "p": "后端", "l": "杭州", "u": "https://hr.163.com/b"},
            {"c": "网易", "p": "前端", "l": "杭州", "u": "https://hr.163.com/a"},  # duplicate row
        ]
        companies = merge_radar_companies(rows)
        self.assertEqual(len(companies), 1)
        company = companies[0]
        self.assertEqual(len(company["sites"]), 1)
        externals = [pos["externalId"] for pos in company["positions"]]
        self.assertEqual(len(externals), len(set(externals)))
        self.assertEqual(len(externals), 2)


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
