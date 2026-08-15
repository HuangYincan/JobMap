import unittest
from domain_map_importer import normalize_import, validate_local_fixture

VALID_FIXTURE = {
    "source": {
        "code": "xiaozhao-radar",
        "original_url": "https://example.invalid/xiaozhao-radar/jobs.json",
        "license_basis": "Apache-2.0", "attribution": "xiaozhao-radar contributors",
        "retrieved_at": "2026-08-15T10:30:00Z", "parser_version": "1.0.0",
        "retention_class": "public",
    },
    "records": [
        {"external_id": "job-2", "attributes": {"title": "Engineer", "city": "Hangzhou"}},
        {"external_id": "job-1", "attributes": {"title": "Analyst", "city": "Shanghai"}},
    ],
}

class LocalFixtureValidationTests(unittest.TestCase):
    def test_validates_only_local_fixture_shape(self):
        validation = validate_local_fixture(VALID_FIXTURE)
        self.assertTrue(validation.valid)
        self.assertEqual(validation.errors, ())

    def test_reports_fixture_shape_errors(self):
        validation = validate_local_fixture({"source": {}, "records": "not-a-list"})
        self.assertFalse(validation.valid)
        self.assertIn("records must be a list", validation.errors)

class NormalizeImportTests(unittest.TestCase):
    def test_normalizes_records_by_external_id_and_captures_provenance(self):
        report = normalize_import(VALID_FIXTURE)
        self.assertTrue(report.valid)
        self.assertEqual([record.external_id for record in report.records], ["job-1", "job-2"])
        self.assertEqual(report.provenance.source_code, "xiaozhao-radar")
        self.assertEqual(report.provenance.retrieved_at, "2026-08-15T10:30:00Z")
        self.assertEqual(report.rejected, ())

    def test_reports_invalid_and_duplicate_records_without_dropping_evidence(self):
        fixture = {**VALID_FIXTURE, "records": [
            {"external_id": "job-1", "attributes": {"title": "Analyst"}},
            {"external_id": "job-1", "attributes": {"title": "Analyst duplicate"}},
            {"external_id": "job-2", "attributes": "not-an-object"},
        ]}
        report = normalize_import(fixture)
        self.assertFalse(report.valid)
        self.assertEqual(report.records, ())
        self.assertEqual([(error.index, error.reason) for error in report.rejected], [
            (0, "duplicate external_id: job-1"),
            (1, "duplicate external_id: job-1"),
            (2, "attributes must be an object"),
        ])

    def test_report_is_deterministic_for_equivalent_input(self):
        first = normalize_import(VALID_FIXTURE)
        second = normalize_import(VALID_FIXTURE)
        self.assertEqual(first.to_json(), second.to_json())
        self.assertEqual(first.provenance.content_hash, second.provenance.content_hash)

    def test_keeps_valid_records_alongside_rejected_ones(self):
        fixture = {**VALID_FIXTURE, "records": [
            {"external_id": "job-1", "attributes": {"title": "Analyst"}},
            {"external_id": "job-2", "attributes": "not-an-object"},
        ]}
        report = normalize_import(fixture)
        self.assertFalse(report.valid)
        # The valid record is not silently dropped with the rejected sibling.
        self.assertEqual([record.external_id for record in report.records], ["job-1"])
        self.assertEqual(len(report.rejected), 1)
        self.assertEqual(report.rejected[0].index, 1)
