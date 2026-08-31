import unittest

from domain_map_importer import ManifestValidationError, validate_manifest

VALID_MANIFEST = {
    "code": "recruitment", "version": "1.0.0", "schemaVersion": 1,
    "owner": "platform", "entityType": "employer", "itemType": "job",
    "entityFields": {"name": {"type": "string", "required": True}},
    "itemFields": {"title": {"type": "string", "required": True}},
    "capabilities": ["seed-import", "spatial-query"],
    "dataPolicy": {"sourceRequired": True, "retentionClass": "public"},
}

class ValidateManifestTests(unittest.TestCase):
    def test_accepts_supported_declarative_contract(self):
        manifest = validate_manifest(VALID_MANIFEST)
        self.assertEqual(manifest["code"], "recruitment")
        self.assertEqual(manifest["capabilities"], ("seed-import", "spatial-query"))

    def test_rejects_runtime_code_and_unknown_capabilities(self):
        with self.assertRaisesRegex(ManifestValidationError, "unsupported keys"):
            validate_manifest({**VALID_MANIFEST, "entrypoint": "importer.run"})
        with self.assertRaisesRegex(ManifestValidationError, "unsupported capability"):
            validate_manifest({**VALID_MANIFEST, "capabilities": ["live-crawl"]})

    def test_rejects_non_semantic_version(self):
        with self.assertRaisesRegex(ManifestValidationError, "semantic version"):
            validate_manifest({**VALID_MANIFEST, "version": "first"})
