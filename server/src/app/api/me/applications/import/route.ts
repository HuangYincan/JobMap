import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { DbUnavailableError, recordApplications } from "@/lib/account-store";
import { sanitizeApplicationPipeline } from "@/lib/application-pipeline";
import {
  APPLICATION_CSV_IMPORT_MAX,
  type ApplicationCsvRow,
} from "@/lib/application-csv";
import { parseApplicationWrite } from "@/lib/application-write";
import { RequestBodyTooLargeError, readJsonObjectBody } from "@/lib/request-body";

function noStoreJson(body: unknown, init?: { status?: number }) {
  const response = NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store" },
  });
  return response;
}

const IMPORT_JSON_MAX_CHARS = 128 * 1024;

export async function POST(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return noStoreJson({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  let body: { rows?: unknown };
  try {
    body = await readJsonObjectBody<typeof body>(request, IMPORT_JSON_MAX_CHARS);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return noStoreJson(
        { code: "BODY_TOO_LARGE", message: "request body too large" },
        { status: 400 },
      );
    }
    return noStoreJson({ code: "BAD_REQUEST", message: "invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.rows)) {
    return noStoreJson({ code: "BAD_REQUEST", message: "rows array required" }, { status: 400 });
  }
  if (body.rows.length > APPLICATION_CSV_IMPORT_MAX) {
    return noStoreJson(
      { code: "IMPORT_TOO_LARGE", message: `at most ${APPLICATION_CSV_IMPORT_MAX} rows` },
      { status: 400 },
    );
  }

  const catalog = sanitizeApplicationPipeline(user.preferences.applicationPipeline).statuses;
  const writes = [];
  let skipped = 0;
  for (const raw of body.rows) {
    if (!raw || typeof raw !== "object") {
      skipped += 1;
      continue;
    }
    const row = raw as ApplicationCsvRow;
    const parsed = parseApplicationWrite(
      {
        title: row.title,
        companyName: row.companyName,
        applyUrl: row.applyUrl,
        status: row.status,
        appliedAt: row.appliedAt,
      },
      catalog,
      { lang: user.preferences.language, invalidUrl: "omit" },
    );
    if (!parsed.ok) {
      skipped += 1;
      continue;
    }
    writes.push(parsed.value);
  }

  try {
    const items = await recordApplications(user.id, writes);
    return noStoreJson({
      items,
      imported: items.length,
      skipped,
    });
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
