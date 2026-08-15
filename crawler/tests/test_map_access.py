import unittest
from domain_map_importer import can_access_map, map_access


class MapAccessTests(unittest.TestCase):
    def test_public_map_is_world_readable(self):
        anonymous = map_access(action="read", visibility="public", principal_id=None, owner_id="owner-1")
        non_member = map_access(action="read", visibility="public", principal_id="other-1", owner_id="owner-1")
        self.assertTrue(anonymous.allowed)
        self.assertTrue(non_member.allowed)
        self.assertEqual(non_member.reason, "public-read")

    def test_public_map_write_still_requires_authentication(self):
        denied = map_access(action="write", visibility="public", principal_id=None, owner_id="owner-1")
        self.assertFalse(denied.allowed)
        self.assertEqual(denied.reason, "authentication-required")

    def test_membership_roles_have_expected_permissions(self):
        editor = can_access_map(action="write", visibility="private", principal_id="editor-1", owner_id="owner-1", membership_role="editor")
        viewer = can_access_map(action="write", visibility="private", principal_id="viewer-1", owner_id="owner-1", membership_role="viewer")
        owner = can_access_map(action="manage", visibility="private", principal_id="owner-1", owner_id="owner-1")
        self.assertTrue(editor.allowed)
        self.assertFalse(viewer.allowed)
        self.assertTrue(owner.allowed)

    def test_owner_is_identified_by_owner_id_not_membership_role(self):
        # membership_role only ever holds editor/viewer in the SQL model; a caller
        # must not be able to claim the owner role by passing membership_role.
        spoofed = map_access(action="manage", visibility="private", principal_id="attacker-1", owner_id="owner-1", membership_role="owner")
        self.assertFalse(spoofed.allowed)
        self.assertEqual(spoofed.reason, "insufficient-role")

    def test_anonymous_private_read_is_denied(self):
        decision = can_access_map(action="read", visibility="private", principal_id=None, owner_id="owner-1")
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "authentication-required")
