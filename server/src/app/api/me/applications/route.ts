import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { listApplications, recordApplication } from "@/lib/account-store";
import { RequestBodyTooLargeError, readJsonBody } from '@/lib/request-body';

const MAX_ID_LENGTH = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_COMPANY_NAME_LENGTH = 200;
const MAX_APPLY_URL_LENGTH = 2048;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

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
    body = await readJsonBody<typeof body>(request);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { code: "BODY_TOO_LARGE", message: "request body too large" },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: "BAD_REQUEST", message: "invalid JSON" }, { status: 400 });
  }
  const positionId = (body.positionId || "").trim();
  const companyPoiId = (body.companyPoiId || "").trim();
  const title = (body.title || "").trim();
  const companyName = (body.companyName || "").trim();
  if (!positionId || !companyPoiId || !title || !companyName) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "position and company required" }, { status: 400 });
  }
  if (
    positionId.length > MAX_ID_LENGTH ||
    companyPoiId.length > MAX_ID_LENGTH ||
    title.length > MAX_TITLE_LENGTH ||
    companyName.length > MAX_COMPANY_NAME_LENGTH
  ) {
    return NextResponse.json(
      { code: "APPLICATION_FIELD_TOO_LONG", message: "one or more application fields exceed their length limit" },
      { status: 400 },
    );
  }

  const applyUrl = (body.applyUrl || "").trim();
  if (applyUrl && (applyUrl.length > MAX_APPLY_URL_LENGTH || !isHttpUrl(applyUrl))) {
    return NextResponse.json(
      { code: "INVALID_APPLY_URL", message: "applyUrl must be an http(s) URL of at most 2048 chars" },
      { status: 400 },
    );
  }
  const item = await recordApplication(user.id, {
    positionId,
    companyPoiId,
    title,
    companyName,
    applyUrl: applyUrl || undefined,
    status: "applied",
  });
  return NextResponse.json({ item });
}
