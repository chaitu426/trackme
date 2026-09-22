export interface GeoInfo {
  country?: string | undefined;
  city?: string | undefined;
}

/**
 * Derive country/city transiently from headers (Cloudflare, CloudFront, Nginx, or Fastify req)
 * Note: Full raw IP is discarded immediately after processing.
 */
export function extractGeoFromHeaders(headers: Record<string, string | string[] | undefined>): GeoInfo {
  const getHeader = (key: string): string | undefined => {
    const val = headers[key];
    return Array.isArray(val) ? val[0] : val;
  };

  // Cloudflare CF-IPCountry
  const cfCountry = getHeader("cf-ipcountry");
  if (cfCountry && cfCountry.length === 2 && cfCountry !== "XX") {
    return {
      country: cfCountry.toUpperCase(),
      city: getHeader("cf-ipcity"),
    };
  }

  // CloudFront CloudFront-Viewer-Country
  const cfViewerCountry = getHeader("cloudfront-viewer-country");
  if (cfViewerCountry && cfViewerCountry.length === 2) {
    return {
      country: cfViewerCountry.toUpperCase(),
      city: getHeader("cloudfront-viewer-city"),
    };
  }

  // No CDN geo headers present (e.g. direct-to-origin or local development).
  // Leave country/city undefined rather than fabricating a value - a fake
  // "US/Local" default would silently corrupt geo breakdowns.
  return {};
}

/**
 * True when the event URL is localhost, loopback, or a file:// page.
 * Used to enforce site.settings.allowLocalhostTracking.
 */
export function isLocalOrFileUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "file:") return true;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      host.endsWith(".localhost")
    );
  } catch {
    return /^(file:|https?:\/\/(localhost|127\.0\.0\.1|\[::1\]))/i.test(rawUrl);
  }
}

/**
 * Strip URL query parameters except approved campaign parameters (UTM)
 */
export function sanitizeUrl(rawUrl: string): { sanitizedUrl: string; sanitizedPath: string } {
  try {
    const parsed = new URL(rawUrl);
    const searchParams = new URLSearchParams();

    const allowedParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
    ];

    for (const key of allowedParams) {
      const val = parsed.searchParams.get(key);
      if (val) {
        searchParams.set(key, val);
      }
    }

    const query = searchParams.toString();
    // file:// URLs report origin as the string "null" - rebuild a safe origin.
    const origin =
      parsed.protocol === "file:" || parsed.origin === "null"
        ? `${parsed.protocol}//`
        : parsed.origin;
    const sanitizedUrl = `${origin}${parsed.pathname}${query ? `?${query}` : ""}`;
    const sanitizedPath = `${parsed.pathname}${query ? `?${query}` : ""}`;

    return { sanitizedUrl, sanitizedPath };
  } catch {
    // The URL failed to parse, so we can't safely separate path from query.
    // Never forward the raw value: it may still carry a query string with
    // PII. Best-effort strip everything from the first '?' or '#'.
    const withoutQuery = rawUrl.split(/[?#]/, 1)[0] ?? "";
    return { sanitizedUrl: withoutQuery, sanitizedPath: withoutQuery };
  }
}

