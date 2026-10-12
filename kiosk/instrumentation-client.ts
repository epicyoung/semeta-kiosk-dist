import * as Sentry from '@sentry/nextjs'
import { sentryShared } from './sentry.shared'

// Session Replay SENGAJA ga dipasang: replay ngerekam layar kiosk = foto wajah tamu
// ikut kekirim ke Sentry. Itu di luar consent tamu.
Sentry.init({
  ...sentryShared,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
