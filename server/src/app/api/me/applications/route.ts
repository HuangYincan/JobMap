import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { DbUnavailableError, listApplications, recordApplication, removeApplication, updateApplicationStatus } from "@/lib/account-store";
import {
  coerceStatusToCatalog,
  sanitizeApplicationPipeline,
  sanitizeApplicationStatusId,
} from "@/lib/application-pipeline";
import { parseApplicationWrite } from "@/lib/application-write";
import { RequestBodyTooLargeError, readJsonObjectBody } from "@/lib/request-body";

const MAX_ID_LENGTH = 200;

export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: { status?: number }) {
  const response = NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store" },
  });
  return response;
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
    return noStoreJson({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
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
  const catalog = sanitizeApplicationPipeline(user.preferences.applicationPipeline).statuses;
  const parsed = parseApplicationWrite(body, catalog, {
    lang: user.preferences.language,
    invalidUrl: "reject",
  });
  if (!parsed.ok) {
    return noStoreJson({ code: parsed.code, message: parsed.message }, { status: 400 });
  }
  try {
    const item = await recordApplication(user.id, parsed.value);
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

export async function PATCH(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return noStoreJson({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  let body: { id?: string; status?: string };
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
  if (typeof body.id !== "string" || typeof body.status !== "string") {
    return noStoreJson({ code: "BAD_REQUEST", message: "id and status must be strings" }, { status: 400 });
  }
  const id = body.id.trim();
  const requested = sanitizeApplicationStatusId(body.status);
  if (!id || id.length > MAX_ID_LENGTH || !requested) {
    return noStoreJson({ code: "BAD_REQUEST", message: "id and status required" }, { status: 400 });
  }
  const catalog = sanitizeApplicationPipeline(user.preferences.applicationPipeline).statuses;
  const status = coerceStatusToCatalog(requested, catalog);
  if (!status) {
    return noStoreJson({ code: "UNKNOWN_STATUS", message: "status is not in the user pipeline" }, { status: 400 });
  }
  try {
    const item = await updateApplicationStatus(user.id, id, status);
    if (!item) {
      return noStoreJson({ code: "NOT_FOUND", message: "application not found" }, { status: 404 });
    }
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
  const user = await readSessionUser();
  if (!user) {
    return noStoreJson({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  if (!id || id.length > MAX_ID_LENGTH) {
    return noStoreJson({ code: "BAD_REQUEST", message: "id required" }, { status: 400 });
  }
  try {
    await removeApplication(user.id, id);
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
