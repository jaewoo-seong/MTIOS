import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "mti_session";
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/health",
  "/api/v1/auth/login"
]);
const ADMIN_API_PREFIXES = [
  "/api/v1/admin/",
  "/api/v1/settings/models",
  "/api/v1/settings/integrations"
];

type Claims = {
  role: "admin" | "member";
  expiresAt: number;
};

/**
 * Edge middleware: signature + expiry only. It cannot reach Postgres (Edge
 * runtime has no TCP sockets, and — confirmed empirically, not assumed —
 * this Next.js version's middleware `config` schema is `.strict()` with no
 * `runtime` key, so declaring `runtime: "nodejs"` doesn't switch runtimes,
 * it fails schema validation and Next drops the middleware entirely with no
 * build error. Do not reintroduce that without confirming the manifest at
 * .next/server/middleware-manifest.json is non-empty after the build).
 *
 * Because this can't check `revoked_at`, it cannot detect logout, admin
 * revocation, or a post-password-change kill — those are enforced by
 * `currentSession()` (lib/auth.ts), which every route handling sensitive
 * data must call explicitly. This is the known, tracked gap: most routes
 * currently rely on this signature-only check alone.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC_PATHS.has(path)) return NextResponse.next();

  if (path.startsWith("/api/internal/")) {
    const secret = process.env.WORKFLOW_CALLBACK_SECRET;
    if (secret && request.headers.get("authorization") === `Bearer ${secret}`) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sessionSecret = process.env.AUTH_SESSION_SECRET;
  if (!sessionSecret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "authentication_not_configured" }, { status: 503 });
    }
    return NextResponse.next();
  }

  const claims = await verifyCookie(request.cookies.get(COOKIE_NAME)?.value, sessionSecret);
  if (!claims) return unauthenticated(request);
  if (ADMIN_API_PREFIXES.some((prefix) => path.startsWith(prefix)) && claims.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (isMutation(request.method) && !sameOrigin(request)) {
    return NextResponse.json({ error: "csrf_validation_failed" }, { status: 403 });
  }
  return NextResponse.next();
}

function unauthenticated(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (request.nextUrl.pathname !== "/") {
    login.searchParams.set("next", request.nextUrl.pathname);
  }
  return NextResponse.redirect(login);
}

function isMutation(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return origin === `${forwardedProto}://${forwardedHost}`;
}

async function verifyCookie(value: string | undefined, secret: string): Promise<Claims | null> {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(signature),
    new TextEncoder().encode(payload)
  );
  if (!valid) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as Claims;
    return claims.expiresAt > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
