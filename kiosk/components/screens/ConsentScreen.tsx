'use client'
import { type Dispatch } from 'react'
import { TouchButton } from '@/components/ui/TouchButton'
import type { KioskAction } from '@/lib/types'
import { useT } from '@/lib/i18n'

const S = {
  // Section heading sits ABOVE body in the scale (was --text-xs, smaller than
  // body — inverted hierarchy). textWrap balance keeps 2-line headings even.
  heading: { fontSize: 'var(--text-sm)', fontWeight: 600, color: 'white', marginBottom: 6, marginTop: 14, textWrap: 'balance' } as const,
  // These consent paragraphs are short (2-4 lines). `balance` evens all lines
  // out — stronger than `pretty` (which only nudges the last line) for short
  // blocks, so no single-word widow is left dangling.
  body: { fontSize: 'var(--text-sm)', fontWeight: 300, color: 'rgba(255,255,255,0.85)', lineHeight: 1.7, margin: 0, textWrap: 'balance' } as const,
  li: { marginBottom: 4 } as const,
  divider: { height: 1, background: 'rgba(255,255,255,0.12)', margin: '14px 0' } as const,
}

export function ConsentScreen({ dispatch }: { dispatch: Dispatch<KioskAction> }) {
  const t = useT()
  const consentItems = t('consent_policy_consent_items') as string[]
  const s2Items = t('consent_policy_s2_items') as string[]
  const s3Items = t('consent_policy_s3_items') as string[]
  const s7Items = t('consent_policy_s7_items') as string[]

  return (
    <div className="screen-split flex flex-col w-full h-full overflow-hidden">
      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1 className="h1-glow" style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>
          {t('consent_title') as string}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, whiteSpace: 'pre-line' }}>
          {t('consent_subtitle') as string}
        </p>
        <p style={{ fontSize: 'var(--text-xs)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.6, textAlign: 'center', fontStyle: 'italic', marginTop: 6, opacity: 0.7, textWrap: 'balance' }}>
          {t('consent_minor') as string}
        </p>
      </div>

      <div className="screen-content">
        <div
          className="consent-scroll overflow-y-auto rounded-2xl px-5 py-4"
          style={{ background: 'rgba(0,0,0,0.5)', width: 500, maxWidth: '100%', height: 888, margin: 'auto' }}
        >
          <p style={{ fontSize: 'var(--text-2xs)', fontWeight: 400, color: 'white', marginBottom: 10, letterSpacing: '0.04em' }}>
            {t('consent_policy_header') as string}
          </p>

          <p style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'white', marginBottom: 8, textWrap: 'balance' }}>{t('consent_policy_consent_heading') as string}</p>
          <p style={S.body}>{t('consent_policy_consent_intro') as string}</p>
          <ul style={{ ...S.body, paddingLeft: 18, marginTop: 6 }}>
            {consentItems.map((item, i) => (
              <li key={i} style={S.li}>{item}</li>
            ))}
          </ul>
          <p style={{ ...S.body, marginTop: 10 }}>{t('consent_policy_consent_reject') as string}</p>
          <p style={{ ...S.body, marginTop: 6 }}>{t('consent_policy_consent_minor') as string}</p>

          <div style={S.divider} />

          <p style={S.heading}>{t('consent_policy_s1_heading') as string}</p>
          <p style={S.body}>{t('consent_policy_s1_body') as string}</p>

          <p style={S.heading}>{t('consent_policy_s2_heading') as string}</p>
          <ul style={{ ...S.body, paddingLeft: 18 }}>
            {s2Items.map((item, i) => (
              <li key={i} style={S.li}>{item}</li>
            ))}
          </ul>
          <p style={{ ...S.body, marginTop: 6 }}>{t('consent_policy_s2_footer') as string}</p>

          <p style={S.heading}>{t('consent_policy_s3_heading') as string}</p>
          <p style={S.body}>{t('consent_policy_s3_intro') as string}</p>
          <ul style={{ ...S.body, paddingLeft: 18, marginTop: 6 }}>
            {s3Items.map((item, i) => (
              <li key={i} style={S.li}>{item}</li>
            ))}
          </ul>

          <p style={S.heading}>{t('consent_policy_s4_heading') as string}</p>
          <p style={S.body}>{t('consent_policy_s4_body') as string}</p>

          <p style={S.heading}>{t('consent_policy_s5_heading') as string}</p>
          <p style={S.body}>{t('consent_policy_s5_body') as string}</p>

          <p style={S.heading}>{t('consent_policy_s6_heading') as string}</p>
          <p style={S.body}>{t('consent_policy_s6_intro') as string}</p>

          <p style={S.heading}>{t('consent_policy_s7_heading') as string}</p>
          <ul style={{ ...S.body, paddingLeft: 18 }}>
            {s7Items.map((item, i) => (
              <li key={i} style={S.li}>{item}</li>
            ))}
          </ul>
          <p style={{ ...S.body, marginTop: 6 }}>{t('consent_policy_s7_footer') as string}</p>

          <p style={S.heading}>{t('consent_policy_s8_heading') as string}</p>
          <p style={S.body}>{t('consent_policy_s8_body') as string}</p>

          <p style={S.heading}>{t('consent_policy_s9_heading') as string}</p>
          <p style={S.body}>{t('consent_policy_s9_body') as string}</p>

          <p style={S.heading}>{t('consent_policy_s10_heading') as string}</p>
          <p style={S.body}>{t('consent_policy_s10_body') as string}</p>

          <p style={S.heading}>{t('consent_policy_s11_heading') as string}</p>
          <p style={{ ...S.body, marginBottom: 2 }}>{t('consent_policy_s11_company') as string}</p>
          <p style={{ ...S.body, marginBottom: 2 }}>{t('consent_policy_s11_email') as string}</p>
          <p style={{ ...S.body, marginBottom: 12 }}>{t('consent_policy_s11_wa') as string}</p>

          <div style={S.divider} />
          <p style={{ fontSize: 'var(--text-2xs)', fontWeight: 400, color: 'white', textAlign: 'center', paddingBottom: 2 }}>
            {t('consent_policy_footer') as string}
          </p>
        </div>
      </div>

      <div className="screen-actions shrink-0 p-5 flex flex-row gap-4">
        <TouchButton className="flex-1" onClick={() => dispatch({ type: 'BACK' })}>
          {t('consent_back') as string}
        </TouchButton>
        <TouchButton className="flex-1" onClick={() => dispatch({ type: 'CONSENT_GIVEN' })}>
          {t('consent_agree') as string}
        </TouchButton>
      </div>
    </div>
  )
}
