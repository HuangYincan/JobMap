from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from collections.abc import Mapping
from typing import Any

_REQUIRED_SOURCE_KEYS = {"code", "original_url", "license_basis", "attribution", "retrieved_at", "parser_version", "retention_class"}


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    errors: tuple[str, ...]


@dataclass(frozen=True)
class Provenance:
    source_code: str
    original_url: str
    license_basis: str
    attribution: str
    retrieved_at: str
    parser_version: str
    retention_class: str
    content_hash: str


@dataclass(frozen=True)
class NormalizedRecord:
    external_id: str
    attributes: dict[str, Any]


@dataclass(frozen=True)
class RejectedRecord:
    index: int
    reason: str
    record: Any


@dataclass(frozen=True)
class ImportReport:
    valid: bool
    records: tuple[NormalizedRecord, ...]
    rejected: tuple[RejectedRecord, ...]
    provenance: Provenance | None

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def validate_local_fixture(fixture: Mapping[str, Any]) -> ValidationResult:
    errors: list[str] = []
    if not isinstance(fixture, Mapping):
        return ValidationResult(False, ("fixture must be an object",))
    source = fixture.get("source")
    if not isinstance(source, Mapping):
        errors.append("source must be an object")
    else:
        missing = sorted(_REQUIRED_SOURCE_KEYS - set(source))
        if missing:
            errors.append(f"source missing keys: {', '.join(missing)}")
        for key in _REQUIRED_SOURCE_KEYS:
            if key in source and not isinstance(source[key], str) or key in source and not source[key].strip():
                errors.append(f"source.{key} must be a non-empty string")
        if isinstance(source, Mapping) and source.get("retention_class") not in {"public", "tenant-private"}:
            errors.append("source.retention_class must be public or tenant-private")
    if not isinstance(fixture.get("records"), list):
        errors.append("records must be a list")
    return ValidationResult(not errors, tuple(errors))


def normalize_import(fixture: Mapping[str, Any]) -> ImportReport:
    validation = validate_local_fixture(fixture)
    if not validation.valid:
        return ImportReport(False, (), (), None)
    source = fixture["source"]
    records = fixture["records"]
    content_hash = hashlib.sha256(_canonical_json(fixture).encode("utf-8")).hexdigest()
    provenance = Provenance(
        source_code=source["code"], original_url=source["original_url"], license_basis=source["license_basis"],
        attribution=source["attribution"], retrieved_at=source["retrieved_at"], parser_version=source["parser_version"],
        retention_class=source["retention_class"], content_hash=content_hash,
    )
    seen: set[str] = set()
    duplicate_ids = {
        external_id
        for external_id in {
            record.get("external_id")
            for record in records
            if isinstance(record, Mapping) and isinstance(record.get("external_id"), str)
        }
        if sum(
            1
            for record in records
            if isinstance(record, Mapping) and record.get("external_id") == external_id
        ) > 1
    }
    normalized: list[NormalizedRecord] = []
    rejected: list[RejectedRecord] = []
    for index, record in enumerate(records):
        if not isinstance(record, Mapping):
            rejected.append(RejectedRecord(index, "record must be an object", record))
            continue
        external_id = record.get("external_id")
        attributes = record.get("attributes")
        if not isinstance(external_id, str) or not external_id.strip():
            rejected.append(RejectedRecord(index, "external_id must be a non-empty string", record))
            continue
        if external_id in duplicate_ids:
            rejected.append(RejectedRecord(index, f"duplicate external_id: {external_id}", record))
            continue
        seen.add(external_id)
        if not isinstance(attributes, Mapping):
            rejected.append(RejectedRecord(index, "attributes must be an object", record))
            continue
        normalized.append(NormalizedRecord(external_id, dict(attributes)))
    if rejected:
        return ImportReport(False, (), tuple(rejected), provenance)
    normalized.sort(key=lambda record: record.external_id)
    return ImportReport(True, tuple(normalized), (), provenance)
