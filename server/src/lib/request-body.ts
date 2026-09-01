export const DEFAULT_JSON_BODY_MAX_CHARS = 16 * 1024;

export class RequestBodyTooLargeError extends Error {
  readonly limit: number;
  readonly unit: 'chars' | 'bytes';

  constructor(limit: number, unit: 'chars' | 'bytes' = 'chars') {
    super(`request body exceeds ${limit} ${unit}`);
    this.name = 'RequestBodyTooLargeError';
    this.limit = limit;
    this.unit = unit;
  }
}

/** JSON object roots are deliberately stricter than `typeof value === 'object'`:
 * null and arrays must never reach route field access or be treated as records. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Parse a bounded JSON body and require a plain-object root. */
export async function readJsonObjectBody<T>(
  request: Request,
  maxChars: number = DEFAULT_JSON_BODY_MAX_CHARS,
): Promise<T> {
  const value = await readJsonBody<unknown>(request, maxChars);
  if (!isPlainObject(value)) {
    throw new TypeError('JSON body must be a plain object');
  }
  return value as T;
}

/** Stream-read at most maxBytes without materializing an unbounded request. */
export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<ArrayBuffer> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive integer');
  }

  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  let cancelled = false;
  const cancelOnce = async () => {
    if (cancelled) return;
    cancelled = true;
    await reader.cancel().catch(() => undefined);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await cancelOnce();
        throw new RequestBodyTooLargeError(maxBytes, 'bytes');
      }
      chunks.push(value);
    }
  } catch (error) {
    await cancelOnce();
    throw error;
  }

  const output = new ArrayBuffer(total);
  const bytes = new Uint8Array(output);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/** Parse a bounded JSON request body before application logic sees it. */
export async function readJsonBody<T>(
  request: Request,
  maxChars: number = DEFAULT_JSON_BODY_MAX_CHARS,
): Promise<T> {
  // UTF-8 needs up to four bytes per code point; this keeps the memory bound
  // while preserving the existing character-based public limit.
  const buffer = await readBoundedRequestBody(request, maxChars * 4);
  const raw = new TextDecoder().decode(buffer);
  if (raw.length > maxChars) {
    throw new RequestBodyTooLargeError(maxChars);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new SyntaxError((cause as Error)?.message || 'invalid JSON');
  }
}
