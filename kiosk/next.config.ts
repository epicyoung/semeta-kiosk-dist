import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const isDev = process.env.NODE_ENV !== "production";

// CSP konservatif: semua asset self-hosted (next/font), gambar template dari R2 (https),
// video dari blob, Sentry ingest. Dev butuh eval + websocket buat HMR.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http://localhost:8000 http://127.0.0.1:8000",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' blob: http://localhost:8000 http://127.0.0.1:8000 https://*.sentry.io https://*.ingest.sentry.io${isDev ? " ws://127.0.0.1:* ws://localhost:*" : ""}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Tanpa SENTRY_AUTH_TOKEN (mesin lapangan build sendiri, ga punya token) upload source map
// di-skip otomatis, build tetep sukses. Token cuma perlu di mesin yang mau upload source map.
export default withSentryConfig(nextConfig, {
  org: "spindonesiacom",
  project: "javascript-nextjs",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  silent: !process.env.CI,
  telemetry: false,
});
