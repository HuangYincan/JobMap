import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { DbUnavailableError, reassignApplicationStatuses, updateUser } from "@/lib/account-store";
import {
  fallbackStatusId,
  sanitizeApplicationPipeline,
} from "@/lib/application-pipeline";
import { RequestBodyTooLargeError, readJsonObjectBody } from "@/lib/request-body";

function noStoreJson(body: unknown, init?: { status?: number }) {
  const response = NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store" },
  });
  return response;
}

export async function PUT(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return noStoreJson({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  let body: { statuses?: unknown };
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

  const previous = sanitizeApplicationPipeline(user.preferences.applicationPipeline);
  const pipeline = sanitizeApplicationPipeline({ statuses: body.statuses });
  const nextIds = new Set(pipeline.statuses.map((item) => item.id));
  const removed = previous.statuses
    .map((item) => item.id)
    .filter((id) => !nextIds.has(id));

  try {
    const nextUser = await updateUser(user.id, {
      preferences: { applicationPipeline: pipeline },
    });
    if (removed.length) {
      await reassignApplicationStatuses(user.id, removed, fallbackStatusId(pipeline.statuses));
    }
    return noStoreJson({
      pipeline,
      user: nextUser,
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
