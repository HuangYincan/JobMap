import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { reassignApplicationStatuses, updateUser } from "@/lib/account-store";
import {
  fallbackStatusId,
  sanitizeApplicationPipeline,
} from "@/lib/application-pipeline";
import { RequestBodyTooLargeError, readJsonBody } from "@/lib/request-body";

export async function PUT(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  let body: { statuses?: unknown };
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

  const previous = sanitizeApplicationPipeline(user.preferences.applicationPipeline);
  const pipeline = sanitizeApplicationPipeline({ statuses: body.statuses });
  const nextIds = new Set(pipeline.statuses.map((item) => item.id));
  const removed = previous.statuses
    .map((item) => item.id)
    .filter((id) => !nextIds.has(id));

  const nextUser = await updateUser(user.id, {
    preferences: { applicationPipeline: pipeline },
  });
  if (removed.length) {
    await reassignApplicationStatuses(user.id, removed, fallbackStatusId(pipeline.statuses));
  }
  return NextResponse.json({
    pipeline,
    user: nextUser,
  });
}
