import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
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
