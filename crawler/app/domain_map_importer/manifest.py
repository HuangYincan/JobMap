from __future__ import annotations

import re
from collections.abc import Mapping
from copy import deepcopy
from typing import Any


class ManifestValidationError(ValueError):
    """Raised when a plugin manifest is not a supported declarative contract."""


_MANIFEST_KEYS = {
    "code", "version", "schemaVersion", "owner", "entityType", "itemType",
    "entityFields", "itemFields", "capabilities", "dataPolicy",
}
_CAPABILITIES = {"seed-import", "api-import", "spatial-query", "map-render"}
_SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")


def validate_manifest(manifest: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(manifest, Mapping):
        raise ManifestValidationError("manifest must be an object")
    unsupported = sorted(set(manifest) - _MANIFEST_KEYS)
    if unsupported:
        raise ManifestValidationError(f"unsupported keys: {', '.join(unsupported)}")
    required = ("code", "version", "schemaVersion", "owner", "entityType", "entityFields", "capabilities", "dataPolicy")
    missing = [key for key in required if key not in manifest]
    if missing:
        raise ManifestValidationError(f"missing keys: {', '.join(missing)}")
    if not isinstance(manifest["code"], str) or not re.fullmatch(r"[a-z][a-z0-9-]*", manifest["code"]):
        raise ManifestValidationError("code must be a lowercase identifier")
    if not isinstance(manifest["version"], str) or not _SEMVER.fullmatch(manifest["version"]):
        raise ManifestValidationError("version must be a semantic version")
    if not isinstance(manifest["schemaVersion"], int) or isinstance(manifest["schemaVersion"], bool) or manifest["schemaVersion"] < 1:
        raise ManifestValidationError("schemaVersion must be a positive integer")
    if manifest["owner"] not in {"platform", "tenant"}:
        raise ManifestValidationError("owner must be platform or tenant")
    for field_key in ("entityFields", "itemFields"):
        if field_key in manifest and not isinstance(manifest[field_key], Mapping):
            raise ManifestValidationError(f"{field_key} must be an object")
    if not isinstance(manifest["capabilities"], list) or not all(isinstance(value, str) for value in manifest["capabilities"]):
        raise ManifestValidationError("capabilities must be a list of strings")
    unsupported_capabilities = sorted(set(manifest["capabilities"]) - _CAPABILITIES)
    if unsupported_capabilities:
        raise ManifestValidationError(f"unsupported capability: {', '.join(unsupported_capabilities)}")
    if len(set(manifest["capabilities"])) != len(manifest["capabilities"]):
        raise ManifestValidationError("capabilities must not contain duplicates")
    policy = manifest["dataPolicy"]
    if not isinstance(policy, Mapping) or set(policy) != {"sourceRequired", "retentionClass"}:
        raise ManifestValidationError("dataPolicy must contain sourceRequired and retentionClass only")
    if not isinstance(policy["sourceRequired"], bool) or policy["retentionClass"] not in {"public", "tenant-private"}:
        raise ManifestValidationError("dataPolicy has invalid values")
    result = deepcopy(dict(manifest))
    result["capabilities"] = tuple(manifest["capabilities"])
    return result
