import unittest
from domain_map_importer import can_access_map, map_access

class MapAccessTests(unittest.TestCase):
    def test_public_map_allows_anonymous_read_only(self):
        allowed = map_access(action="read", visibility="public", principal_id=None, owner_id="owner-1")
        denied = map_access(action="write", visibility="public", principal_id=None, owner_id="owner-1")
        self.assertTrue(allowed.allowed)
        self.assertEqual(allowed.reason, "public-read")
        self.assertFalse(denied.allowed)
        self.assertEqual(denied.reason, "authentication-required")

    def test_membership_roles_have_expected_permissions(self):
        editor = can_access_map(action="write", visibility="private", principal_id="editor-1", owner_id="owner-1", membership_role="editor")
        viewer = can_access_map(action="write", visibility="private", principal_id="viewer-1", owner_id="owner-1", membership_role="viewer")
        owner = can_access_map(action="manage", visibility="private", principal_id="owner-1", owner_id="owner-1")
        self.assertTrue(editor.allowed)
        self.assertFalse(viewer.allowed)
        self.assertTrue(owner.allowed)

    def test_anonymous_private_read_is_denied(self):
        decision = can_access_map(action="read", visibility="private", principal_id=None, owner_id="owner-1")
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "authentication-required")
