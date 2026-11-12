/**
 * One way for the dashboard to call its own API: JSON in, JSON out, and a plain-language message on failure (the API's own
 * `detail`, or a generic line when the request never arrived). Never throws.
 */
export type ApiResult<T = Record<string, unknown>> = { ok: true; body: T } | { ok: false; message: string; status: number };

export async function apiCall<T = Record<string, unknown>>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, message: String(body.detail ?? body.message ?? "Something went wrong. Try again.") };
    return { ok: true, body: body as T };
  } catch {
    return { ok: false, status: 0, message: "The request could not be sent. Check your connection and try again." };
  }
}
