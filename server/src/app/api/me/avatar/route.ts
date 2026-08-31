import { NextResponse } from "next/server";
import { readSessionUser } from "@/lib/http-session";
import { BoundedRateStore } from "@/lib/bounded-rate-store";
import { getAvatarData, updateAvatar } from "@/lib/account-store";
import { checkAvatarImage, MAX_AVATAR_BYTES, MAX_AVATAR_REQUEST_BYTES } from "@/lib/avatar-image";
import { readBoundedRequestBody, RequestBodyTooLargeError } from "@/lib/request-body";

// ============================================================
// 头像真实存储:POST 上传(二进制进 users.avatar_data)、GET 读回。
// 客户端裁剪后已是 256px JPEG(canvas),服务端做无三方依赖的哨兵校验
// (魔数 + 尺寸头 + 字节上限,见 lib/avatar-image.ts)。
// 上传后 avatar_url 写入 /api/me/avatar?v=<时间戳> 版本化路径,
// 换头像即换 URL,GET 可安全 immutable 缓存。OAuth 外部头像不动。
// ============================================================

export async function POST(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }

  // Authenticated users are still bounded before reading multipart bytes:
  // repeated uploads cost streaming, image validation, and durable row writes.
  const now = Date.now();
  const retryAfterMs = checkAvatarUploadLimit(user.id, now);
  if (retryAfterMs > 0) {
    return NextResponse.json(
      {
        code: "AVATAR_RATE_LIMITED",
        message: "too many avatar uploads, try again later",
        retryAfterMs,
      },
      { status: 429, headers: { "Retry-After": Math.ceil(retryAfterMs / 1000).toString() } },
    );
  }
  recordAvatarUpload(user.id, now);

  // Multipart parsing materializes fields; bound the stream first so chunked
  // uploads cannot bypass the Content-Length fast path.
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isInteger(contentLength) && contentLength > MAX_AVATAR_REQUEST_BYTES) {
    return NextResponse.json({ code: "AVATAR_TOO_LARGE", message: "avatar too large" }, { status: 400 });
  }

  let file: File | null = null;
  let formRequest = request;
  try {
    if (request.body && typeof request.body.getReader === "function") {
      const body = await readBoundedRequestBody(request, MAX_AVATAR_REQUEST_BYTES);
      formRequest = new Request(request.url, {
        method: "POST",
        headers: { "content-type": request.headers.get("content-type") ?? "" },
        body,
      });
    }

    const form = await formRequest.formData();
    const entry = form.get("file");
    file = entry instanceof File ? entry : null;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ code: "AVATAR_TOO_LARGE", message: "avatar too large" }, { status: 400 });
    }
    return NextResponse.json({ code: "BAD_REQUEST", message: "invalid multipart form" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "missing file field" }, { status: 400 });
  }

  // Reject by File.size first so an oversized upload is never materialized in a
  // full ArrayBuffer just to fail the same byte-limit check.
  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      { code: "AVATAR_TOO_LARGE", message: "avatar too large" },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkAvatarImage(bytes);
  if (!check.ok) {
    const code = check.reason === "too-large" ? "AVATAR_TOO_LARGE" : "INVALID_AVATAR";
    const message =
      check.reason === "too-large"
        ? "avatar too large"
        : check.reason === "not-image"
          ? "avatar must be a JPEG or PNG image"
          : "unreadable or oversized image dimensions";
    return NextResponse.json({ code, message }, { status: 400 });
  }

  const next = await updateAvatar(user.id, {
    data: bytes,
    url: `/api/me/avatar?v=${Date.now()}`,
  });
  return NextResponse.json({ user: next });
}

const AVATAR_UPLOAD_WINDOW_MS = 60 * 60 * 1000;
const AVATAR_UPLOAD_MAX_PER_WINDOW = 5;
const AVATAR_UPLOAD_GUARD_CAPACITY = 10_000;
const AVATAR_UPLOAD_GUARD_TTL_MS = AVATAR_UPLOAD_WINDOW_MS * 2;
const avatarUploadAttempts = new BoundedRateStore<number[]>(AVATAR_UPLOAD_GUARD_CAPACITY);

function checkAvatarUploadLimit(userId: string, now: number): number {
  const windowStart = now - AVATAR_UPLOAD_WINDOW_MS;
  const attempts = (avatarUploadAttempts.get(userId, now) ?? []).filter((at) => at > windowStart);
  if (attempts.length < AVATAR_UPLOAD_MAX_PER_WINDOW) return 0;
  return attempts[0] + AVATAR_UPLOAD_WINDOW_MS - now;
}

function recordAvatarUpload(userId: string, now: number): void {
  const windowStart = now - AVATAR_UPLOAD_WINDOW_MS;
  const attempts = (avatarUploadAttempts.get(userId, now) ?? []).filter((at) => at > windowStart);
  attempts.push(now);
  avatarUploadAttempts.set(userId, attempts, AVATAR_UPLOAD_GUARD_TTL_MS, now);
}

export async function GET() {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "not signed in" }, { status: 401 });
  }
  const data = await getAvatarData(user.id);
  if (!data || data.length === 0) {
    return NextResponse.json({ code: "NOT_FOUND", message: "no avatar uploaded" }, { status: 404 });
  }
  const check = checkAvatarImage(data);
  const mime = check.ok ? check.mime : "image/jpeg";
  // 拷进独立的 ArrayBuffer(TS:Buffer 派生 Uint8Array 不满足 BodyInit)
  const body = new Uint8Array(data.byteLength);
  body.set(data);
  return new Response(body, {
    headers: {
      "Content-Type": mime,
      // URL 带 ?v= 版本号(换头像即换 URL),可放心 immutable。
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
