import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import {
  DbUnavailableError,
  listSavedStrict,
  removeSavedStrict,
  savePlace,
} from "@/lib/account-store";
import { RequestBodyTooLargeError, readJsonObjectBody } from '@/lib/request-body';
import { canonicalMode, parseKnownMode } from "@/lib/modes";
import { loadServerCatalogByIdStrict } from "@/lib/server-catalog";
import { isPersistableSavedSnapshot } from "@/lib/persistable";
import type { MapMode, RecruitmentPOI } from "@/lib/types";

// 加固（quality-scan #12）：name/poiId 长度上限 + lng/lat 范围校验（对齐 account.ts sanitize 风格）。
const MAX_NAME_LENGTH = 100;
const MAX_POI_ID_LENGTH = 200;
const MAX_ADDRESS_LENGTH = 500;
const MIN_LNG = -180;
const MAX_LNG = 180;
const MIN_LAT = -90;
const MAX_LAT = 90;

export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store" },
  });
}

function isWorkRecruitmentPoi(poi: unknown): poi is RecruitmentPOI {
  return Boolean(
    poi &&
      typeof poi === "object" &&
      (poi as { kind?: unknown }).kind === "recruitment" &&
      canonicalMode((poi as { mode: MapMode }).mode) === "work",
  );
}

export async function GET() {
  try {
    const user = await readSessionUser();
    if (!user) return noStoreJson({ items: [] });
    return noStoreJson({ items: await listSavedStrict(user.id) });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return noStoreJson(
        { code: "DB_UNAVAILABLE", message: "database unavailable, try again later" },
        { status: 503 },
      );
    }
    throw err;
  }
}

export async function POST(request: Request) {
  let user;
  try {
    user = await readSessionUser();
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return noStoreJson(
        { code: "DB_UNAVAILABLE", message: "database unavailable, try again later" },
        { status: 503 },
      );
    }
    throw err;
  }
  if (!user) {
    return noStoreJson({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  let body: {
    poiId?: string;
    name?: string;
    mode?: MapMode;
    kind?: "domain" | "recruitment";
    address?: string;
    lng?: number;
    lat?: number;
  };
  try {
    body = await readJsonObjectBody<typeof body>(request);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return noStoreJson(
        { code: "BODY_TOO_LARGE", message: "request body too large" },
        { status: 400 },
      );
    }
    return noStoreJson({ code: "BAD_REQUEST", message: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.poiId !== "string" || typeof body.name !== "string") {
    return noStoreJson({ code: "BAD_REQUEST", message: "poiId and name must be strings" }, { status: 400 });
  }
  if (body.mode !== undefined && typeof body.mode !== "string") {
    return noStoreJson({ code: "BAD_REQUEST", message: "mode must be a string" }, { status: 400 });
  }
  if (body.address !== undefined && typeof body.address !== "string") {
    return noStoreJson({ code: "BAD_REQUEST", message: "address must be a string" }, { status: 400 });
  }
  if (body.kind !== undefined && body.kind !== "domain" && body.kind !== "recruitment") {
    return noStoreJson({ code: "BAD_REQUEST", message: "invalid kind" }, { status: 400 });
  }
  const poiId = body.poiId.trim();
  const name = body.name.trim();
  if (!poiId || !name) {
    return noStoreJson({ code: "BAD_REQUEST", message: "poiId and name required" }, { status: 400 });
  }
  if (name.length > MAX_NAME_LENGTH) {
    return noStoreJson(
      { code: "NAME_TOO_LONG", message: `name must be at most ${MAX_NAME_LENGTH} chars` },
      { status: 400 },
    );
  }
  if (poiId.length > MAX_POI_ID_LENGTH) {
    return noStoreJson(
      { code: "POI_ID_TOO_LONG", message: `poiId must be at most ${MAX_POI_ID_LENGTH} chars` },
      { status: 400 },
    );
  }
  if (body.address !== undefined && body.address.length > MAX_ADDRESS_LENGTH) {
    return noStoreJson(
      { code: "ADDRESS_TOO_LONG", message: `address must be at most ${MAX_ADDRESS_LENGTH} chars` },
      { status: 400 },
    );
  }
  if (
    body.lng != null &&
    (typeof body.lng !== "number" || !Number.isFinite(body.lng) || body.lng < MIN_LNG || body.lng > MAX_LNG)
  ) {
    return noStoreJson(
      { code: "INVALID_LNG", message: `lng must be a finite number in ${MIN_LNG}..${MAX_LNG}` },
      { status: 400 },
    );
  }
  if (
    body.lat != null &&
    (typeof body.lat !== "number" || !Number.isFinite(body.lat) || body.lat < MIN_LAT || body.lat > MAX_LAT)
  ) {
    return noStoreJson(
      { code: "INVALID_LAT", message: `lat must be a finite number in ${MIN_LAT}..${MAX_LAT}` },
      { status: 400 },
    );
  }
  const mode = parseKnownMode(body.mode);
  if (!mode) {
    return noStoreJson({ code: "INVALID_MODE", message: "unknown mode" }, { status: 400 });
  }
  const kind = body.kind === "recruitment" ? "recruitment" : "domain";
  if (!isPersistableSavedSnapshot({ mode, kind })) {
    return noStoreJson(
      { code: "NOT_PERSISTABLE", message: "only visible work catalog places can be saved" },
      { status: 400 },
    );
  }

  // The browser snapshot is advisory only. Resolve the requested id from the
  // current public work catalog and persist those fields, never client text or
  // coordinates. The strict lookup distinguishes DB outage from a missing row.
  const catalog = await loadServerCatalogByIdStrict(mode, poiId);
  if (catalog === null) {
    return noStoreJson(
      { code: "DB_UNAVAILABLE", message: "database unavailable, try again later" },
      { status: 503 },
    );
  }
  if (!isWorkRecruitmentPoi(catalog)) {
    return noStoreJson(
      { code: "NOT_FOUND", message: "poiId is not a visible work catalog place" },
      { status: 404 },
    );
  }

  try {
    const item = await savePlace(user.id, {
      poiId: catalog.id,
      name: catalog.name,
      mode: "work",
      kind: "recruitment",
      address: catalog.location.address,
      lng: catalog.location.lng,
      lat: catalog.location.lat,
    });
    return noStoreJson({ item });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return noStoreJson(
        { code: "DB_UNAVAILABLE", message: "database unavailable, try again later" },
        { status: 503 },
      );
    }
    throw err;
  }
}

export async function DELETE(request: Request) {
  let user;
  try {
    user = await readSessionUser();
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return noStoreJson(
        { code: "DB_UNAVAILABLE", message: "database unavailable, try again later" },
        { status: 503 },
      );
    }
    throw err;
  }
  if (!user) {
    return noStoreJson({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  const url = new URL(request.url);
  const poiId = (url.searchParams.get("poiId") || "").trim();
  if (!poiId) {
    return noStoreJson({ code: "BAD_REQUEST", message: "poiId required" }, { status: 400 });
  }
  if (poiId.length > MAX_POI_ID_LENGTH) {
    return noStoreJson(
      { code: "POI_ID_TOO_LONG", message: `poiId must be at most ${MAX_POI_ID_LENGTH} chars` },
      { status: 400 },
    );
  }
  try {
    await removeSavedStrict(user.id, poiId);
    return noStoreJson({ ok: true });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return noStoreJson(
        { code: "DB_UNAVAILABLE", message: "database unavailable, try again later" },
        { status: 503 },
      );
    }
    throw err;
  }
}
