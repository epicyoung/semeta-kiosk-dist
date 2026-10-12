import * as Sentry from '@sentry/nextjs'
import { sentryShared } from './sentry.shared'

Sentry.init({
  ...sentryShared,
})
