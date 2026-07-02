'use client'
import type { LockReason } from '@/lib/license'
import { useT } from '@/lib/i18n'

export function LockScreen({ reason, hasSecret, message }: { reason: LockReason; hasSecret: boolean; message?: string }) {
  const t = useT()
  const LOCK_COPY: Record<LockReason, { title: string; sub: string }> = {
    needs_activation: { title: t('lock_needs_activation_title') as string, sub: t('lock_needs_activation_sub') as string },
    needs_reconfirm:  { title: t('lock_needs_reconfirm_title') as string,  sub: t('lock_needs_reconfirm_sub') as string },
    expired:          { title: t('lock_expired_title') as string,           sub: t('lock_expired_sub') as string },
    disabled:         { title: t('lock_disabled_title') as string,          sub: t('lock_disabled_sub') as string },
    force_locked:     { title: t('lock_force_locked_title') as string,      sub: t('lock_force_locked_sub') as string },
  }
  const { title, sub } = LOCK_COPY[reason] ?? LOCK_COPY['needs_activation']
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black px-8 text-center">
      <p className="text-2xl font-semibold text-white">{title}</p>
      <p className="mt-3 max-w-sm text-sm text-white/60">{message ?? sub}</p>
      {!hasSecret && (
        <p className="mt-6 text-xs text-white/30">{t('lock_no_secret') as string}</p>
      )}
    </div>
  )
}
