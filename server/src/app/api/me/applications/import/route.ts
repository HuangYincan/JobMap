import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { recordApplications } from "@/lib/account-store";
import { sanitizeApplicationPipeline } from "@/lib/application-pipeline";
import {
  APPLICATION_CSV_IMPORT_MAX,
  type ApplicationCsvRow,
} from "@/lib/application-csv";
import { parseApplicationWrite } from "@/lib/application-write";
import { RequestBodyTooLargeError, readJsonBody } from "@/lib/request-body";

const IMPORT_JSON_MAX_CHARS = 128 * 1024;

export async function POST(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  let body: { rows?: unknown };
  try {
    body = await readJsonBody<typeof body>(request, IMPORT_JSON_MAX_CHARS);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { code: "BODY_TOO_LARGE", message: "request body too large" },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: "BAD_REQUEST", message: "invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "rows array required" }, { status: 400 });
  }
  if (body.rows.length > APPLICATION_CSV_IMPORT_MAX) {
    return NextResponse.json(
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

  const items = await recordApplications(user.id, writes);
  return NextResponse.json({
    items,
    imported: items.length,
    skipped,
  });
}
