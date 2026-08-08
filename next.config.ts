import type { NextConfig } from "next";

/**
 * Content Security Policy.
 *
 * `'unsafe-inline'` is present for styles and scripts because this app has not
 * been through a nonce pass yet: Next injects inline bootstrap scripts, and the
 * Tiptap editor sets inline styles. Removing either without that work breaks
 * the page, so the honest position is a policy that constrains what it can
 * today - no plugins, no framing, no arbitrary form targets, connections and
 * images limited to self - rather than an aspirational one that has to be
 * disabled the first time someone loads the editor.
 *
 * `connect-src` includes 'self' only. Every external call this app makes -
 * LiteLLM, research providers, MCP, storage - happens server-side, so the
 * browser never needs to reach them. If that changes, the policy should be
 * widened to the specific origin rather than to a wildcard.
 */
const scriptPolicy = process.env.NODE_ENV === "production"
  ? "script-src 'self' 'unsafe-inline'"
  // Next's development runtime uses eval for source maps and React refresh.
  // Keep this exception out of production instead of disabling CSP locally.
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const contentSecurityPolicy = [
  "default-src 'self'",
  scriptPolicy,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  /**
   * Redundant with `frame-ancestors` for modern browsers, kept because it is
   * the header older ones honour and costs nothing.
   */
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  /**
   * Sent unconditionally. Browsers ignore HSTS over plain HTTP, so this is
   * inert in local development and active behind the TLS-terminating proxy in
   * production - which means it does not need to be environment-dependent.
   */
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  /** Dictation may use this origin's microphone; camera/location/payment remain denied. */
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
  /** Keeps this origin out of another document's browsing-context group. */
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" }
];

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  /**
   * Server-rendered HTML should never be cached by a shared proxy: every page
   * here is behind a session and scoped to one workspace.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      },
      {
        source: "/api/:path*",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "no-store, max-age=0" }
        ]
      }
    ];
  }
};

export default nextConfig;
