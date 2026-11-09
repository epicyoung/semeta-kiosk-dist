import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      const { startImportWorker } = await import('./lib/fast-import')
      startImportWorker()
    }
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Error dari route handler /api/* (canon-capture, save-local, dll) & server components.
export const onRequestError = Sentry.captureRequestError
