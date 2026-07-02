import { describe, it, expect } from 'vitest'
import en from '@/lib/locales/en'
import id from '@/lib/locales/id'
import mythEn from '@/lib/locales/myth-en'
import mythId from '@/lib/locales/myth-id'

// Myth locales = plain + oracle-tone override on 8 screen titles/subtitles.
// Contract: overridden keys differ from plain; everything else is inherited verbatim.
describe('Dark Myth locales', () => {
  it('override the screen titles (differ from plain)', () => {
    expect(mythEn.category_title).not.toBe(en.category_title)
    expect(mythEn.category_title).toBe('Path of Visions')
    expect(mythId.category_title).not.toBe(id.category_title)
    expect(mythId.category_title).toBe('Jalur Visi')
  })

  it('inherit non-overridden keys from plain (buttons, dialogs)', () => {
    // nav_next / preview_btn_print are not in the override set → must match plain.
    expect(mythEn.nav_next).toBe(en.nav_next)
    expect(mythEn.preview_btn_print).toBe(en.preview_btn_print)
    expect(mythId.nav_next).toBe(id.nav_next)
    expect(mythId.consent_policy_s11_email).toBe(id.consent_policy_s11_email)
  })

  it('keep the same key set as plain (no missing/extra keys)', () => {
    expect(Object.keys(mythEn).sort()).toEqual(Object.keys(en).sort())
    expect(Object.keys(mythId).sort()).toEqual(Object.keys(id).sort())
  })
})
