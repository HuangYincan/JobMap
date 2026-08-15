from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Action = Literal["read", "write", "manage"]
Visibility = Literal["public", "private"]
Role = Literal["owner", "editor", "viewer"]


@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    reason: str


def map_access(*, action: Action, visibility: Visibility, principal_id: str | None, owner_id: str, membership_role: Role | None = None) -> AccessDecision:
    if action not in {"read", "write", "manage"}:
        raise ValueError("unsupported action")
    if visibility not in {"public", "private"}:
        raise ValueError("unsupported visibility")
    if principal_id is None:
        if visibility == "public" and action == "read":
            return AccessDecision(True, "public-read")
        return AccessDecision(False, "authentication-required")
    if principal_id == owner_id or membership_role == "owner":
        return AccessDecision(True, "owner")
    if membership_role == "editor" and action in {"read", "write"}:
        return AccessDecision(True, "editor")
    if membership_role == "viewer" and action == "read":
        return AccessDecision(True, "viewer")
    return AccessDecision(False, "insufficient-role")


def can_access_map(*, action: Action, visibility: Visibility, principal_id: str | None, owner_id: str, membership_role: Role | None = None) -> AccessDecision:
    return map_access(action=action, visibility=visibility, principal_id=principal_id, owner_id=owner_id, membership_role=membership_role)
