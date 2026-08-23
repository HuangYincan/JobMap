/** Shared fetch timeout guard for external HTTP calls.
 *
 * Node's global fetch does not abort by default, so an unresponsive upstream
 * (proxy, DNS, provider) can leave an API route or tool call pending forever.
 * This helper combines a caller-provided abort signal with an internal deadline
 * and always cancels the timer once the underlying fetch settles.
 */

export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit | undefined,
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetchImpl(input, init);

  const external = init?.signal;
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(external?.reason);
  if (external?.aborted) onExternalAbort();
  else external?.addEventListener('abort', onExternalAbort, { once: true });

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...(init ?? {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}
