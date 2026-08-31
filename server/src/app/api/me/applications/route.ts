import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { DbUnavailableError, listApplications, recordApplication, updateApplicationStatus } from "@/lib/account-store";
import {
  coerceStatusToCatalog,
  sanitizeApplicationPipeline,
  sanitizeApplicationStatusId,
} from "@/lib/application-pipeline";
import { parseApplicationWrite } from "@/lib/application-write";
import { RequestBodyTooLargeError, readJsonBody } from "@/lib/request-body";

const MAX_ID_LENGTH = 200;

export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  const user = await readSessionUser();
  if (!user) return noStoreJson({ items: [] });
  const catalog = sanitizeApplicationPipeline(user.preferences.applicationPipeline).statuses;
  const items = (await listApplications(user.id)).map((item) => {
    const status = coerceStatusToCatalog(item.status, catalog);
    return status && status !== item.status ? { ...item, status } : item;
  });
  return noStoreJson({ items });
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
    status?: string;
    appliedAt?: string;
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
  const catalog = sanitizeApplicationPipeline(user.preferences.applicationPipeline).statuses;
  const parsed = parseApplicationWrite(body, catalog, {
    lang: user.preferences.language,
    invalidUrl: "reject",
  });
  if (!parsed.ok) {
    return NextResponse.json({ code: parsed.code, message: parsed.message }, { status: 400 });
  }
  try {
    const item = await recordApplication(user.id, parsed.value);
    return noStoreJson({ item });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return NextResponse.json(
        { code: "DB_UNAVAILABLE", message: "database unavailable, try again later" },
        { status: 503 },
      );
    }
    throw err;
  }
}

export async function PATCH(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  let body: { id?: string; status?: string };
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
  const id = (body.id || "").trim();
  const requested = sanitizeApplicationStatusId(body.status);
  if (!id || id.length > MAX_ID_LENGTH || !requested) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "id and status required" }, { status: 400 });
  }
  const catalog = sanitizeApplicationPipeline(user.preferences.applicationPipeline).statuses;
  const status = coerceStatusToCatalog(requested, catalog);
  if (!status) {
    return NextResponse.json({ code: "UNKNOWN_STATUS", message: "status is not in the user pipeline" }, { status: 400 });
  }
  const item = await updateApplicationStatus(user.id, id, status);
  if (!item) {
    return NextResponse.json({ code: "NOT_FOUND", message: "application not found" }, { status: 404 });
  }
  return NextResponse.json({ item });
}
