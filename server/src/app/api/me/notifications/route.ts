import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { enqueueNotification, listNotifications } from "@/lib/account-store";
import { matchJobAlerts } from "@/lib/job-alerts";
import { INTERNSHIP_SEED } from "@/lib/seed-data";

export async function GET() {
  const user = await readSessionUser();
  if (!user) return NextResponse.json({ items: [] });
  return NextResponse.json({ items: await listNotifications(user.id) });
}

export async function POST() {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  const matches = matchJobAlerts(INTERNSHIP_SEED, user.preferences.career, user.preferences.notifications);
  const items = [];
  for (const match of matches) {
    items.push(
      await enqueueNotification(user.id, {
        kind: match.kind,
        positionId: match.positionId,
        companyPoiId: match.companyPoiId,
        title: match.title,
        companyName: match.companyName,
        applyUrl: match.applyUrl,
        channels: match.channels,
        status: "queued",
      }),
    );
  }
  return NextResponse.json({ items, scanned: matches.length });
}
