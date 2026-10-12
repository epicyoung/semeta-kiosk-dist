// Opsi Sentry yang dipakai bareng client/server/edge.
// DSN sengaja di-hardcode: kiosk lapangan build sendiri dari repo dist (tanpa .env Sentry),
// dan DSN memang identifier publik, bukan secret. Override via NEXT_PUBLIC_SENTRY_DSN kalau perlu.
// DSN kosong = Sentry mati total (no-op), build & booth tetep jalan.
const SENTRY_DSN = 'https://e4cef6357678f1a8a206f8436783e598@o4512243176308736.ingest.de.sentry.io/4512243227426896'

export const sentryShared = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Errors + tracing (default rekomendasi Sentry). 10% di prod biar kuota ga habis pas event rame.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  // Jangan kirim IP / data tamu.
  sendDefaultPii: false,
}
