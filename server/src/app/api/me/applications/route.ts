import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { listApplications, recordApplication } from "@/lib/account-store";

export async function GET() {
  const user = await readSessionUser();
  if (!user) return NextResponse.json({ items: [] });
  return NextResponse.json({ items: await listApplications(user.id) });
}

export async function POST(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  let body: {
    positionId?: string;
    companyPoiId?: string;
    title?: string;
    companyName?: string;
    applyUrl?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: "BAD_REQUEST", message: "invalid JSON" }, { status: 400 });
  }
  const positionId = (body.positionId || "").trim();
  const companyPoiId = (body.companyPoiId || "").trim();
  const title = (body.title || "").trim();
  const companyName = (body.companyName || "").trim();
  if (!positionId || !companyPoiId || !title || !companyName) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "position and company required" }, { status: 400 });
  }
  const item = await recordApplication(user.id, {
    positionId,
    companyPoiId,
    title,
    companyName,
    applyUrl: body.applyUrl,
    status: "applied",
  });
  return NextResponse.json({ item });
}
