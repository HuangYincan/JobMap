import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { listSaved, removeSaved, savePlace } from "@/lib/account-store";
import { canonicalMode } from "@/lib/modes";
import type { MapMode } from "@/lib/types";

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
  const item = await savePlace(user.id, {
    poiId,
    name,
    mode: canonicalMode(body.mode || "work"),
    kind: body.kind === "recruitment" ? "recruitment" : "domain",
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
