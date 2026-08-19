import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { listSaved, removeSaved, savePlace } from "@/lib/account-store";
import { canonicalMode } from "@/lib/modes";
import { isPersistableSavedSnapshot } from "@/lib/persistable";
import type { MapMode } from "@/lib/types";

// 加固（quality-scan #12）：name/poiId 长度上限 + lng/lat 范围校验（对齐 account.ts sanitize 风格）。
const MAX_NAME_LENGTH = 100;
const MAX_POI_ID_LENGTH = 200;
const MIN_LNG = -180;
const MAX_LNG = 180;
const MIN_LAT = -90;
const MAX_LAT = 90;

export async function GET() {
  const user = await readSessionUser();
  if (!user) return NextResponse.json({ items: [] });
  return NextResponse.json({ items: await listSaved(user.id) });
}

export async function POST(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
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
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: "BAD_REQUEST", message: "invalid JSON" }, { status: 400 });
  }
  const poiId = (body.poiId || "").trim();
  const name = (body.name || "").trim();
  if (!poiId || !name) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "poiId and name required" }, { status: 400 });
  }
  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { code: "NAME_TOO_LONG", message: `name must be at most ${MAX_NAME_LENGTH} chars` },
      { status: 400 },
    );
  }
  if (poiId.length > MAX_POI_ID_LENGTH) {
    return NextResponse.json(
      { code: "POI_ID_TOO_LONG", message: `poiId must be at most ${MAX_POI_ID_LENGTH} chars` },
      { status: 400 },
    );
  }
  if (
    body.lng != null &&
    (typeof body.lng !== "number" || !Number.isFinite(body.lng) || body.lng < MIN_LNG || body.lng > MAX_LNG)
  ) {
    return NextResponse.json(
      { code: "INVALID_LNG", message: `lng must be a finite number in ${MIN_LNG}..${MAX_LNG}` },
      { status: 400 },
    );
  }
  if (
    body.lat != null &&
    (typeof body.lat !== "number" || !Number.isFinite(body.lat) || body.lat < MIN_LAT || body.lat > MAX_LAT)
  ) {
    return NextResponse.json(
      { code: "INVALID_LAT", message: `lat must be a finite number in ${MIN_LAT}..${MAX_LAT}` },
      { status: 400 },
    );
  }
  const mode = canonicalMode(body.mode || "work");
  const kind = body.kind === "recruitment" ? "recruitment" : "domain";
  if (!isPersistableSavedSnapshot({ mode, kind })) {
    return NextResponse.json(
      { code: "NOT_PERSISTABLE", message: "only catalog recruitment places can be saved" },
      { status: 400 },
    );
  }
  const item = await savePlace(user.id, {
    poiId,
    name,
    mode,
    kind,
    address: body.address,
    lng: body.lng,
    lat: body.lat,
  });
  return NextResponse.json({ item });
}

export async function DELETE(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  const url = new URL(request.url);
  const poiId = (url.searchParams.get("poiId") || "").trim();
  if (!poiId) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "poiId required" }, { status: 400 });
  }
  await removeSaved(user.id, poiId);
  return NextResponse.json({ ok: true });
}
