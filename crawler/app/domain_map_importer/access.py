from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Action = Literal["read", "write", "manage"]
Visibility = Literal["public", "private"]
Role = Literal["editor", "viewer"]


@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    reason: str


def map_access(*, action: Action, visibility: Visibility, principal_id: str | None, owner_id: str, membership_role: Role | None = None) -> AccessDecision:
    """Decision for a single map access attempt.

    Rules (must match the SQL model in db/migrations/001):
    - Public maps are world-readable: anonymous and any authenticated principal
      may read them. The owner is identified by ``owner_id`` (maps.owner_user_id),
      never by a membership row (memberships only hold editor/viewer).
    - Writes and management require an authenticated principal.
      editor -> read/write; viewer -> read; owner -> read/write/manage.
    """
    if action not in {"read", "write", "manage"}:
        raise ValueError("unsupported action")
    if visibility not in {"public", "private"}:
        raise ValueError("unsupported visibility")
    if action == "read" and visibility == "public":
        return AccessDecision(True, "public-read")
    if principal_id is None:
        return AccessDecision(False, "authentication-required")
    if principal_id == owner_id:
        return AccessDecision(True, "owner")
    if membership_role == "editor" and action in {"read", "write"}:
        return AccessDecision(True, "editor")
    if membership_role == "viewer" and action == "read":
        return AccessDecision(True, "viewer")
    return AccessDecision(False, "insufficient-role")


# Documented seam name; same policy as ``map_access``.
can_access_map = map_access
