'use client'
import React, { createContext, useContext } from 'react'
import type { Translations } from './locales/types'
import en from './locales/en'
import id from './locales/id'
import ms from './locales/ms'
import th from './locales/th'
import vi from './locales/vi'
import tl from './locales/tl'
import ko from './locales/ko'
import ja from './locales/ja'
import nl from './locales/nl'
import zh from './locales/zh'
import ar from './locales/ar'
import mythEn from './locales/myth-en'
import mythId from './locales/myth-id'

type LocaleDict = Record<string, Translations>
const LOCALES: LocaleDict = { en, id, ms, th, vi, tl, ko, ja, nl, zh, ar, 'myth-en': mythEn, 'myth-id': mythId }

// Returns the full dict — callers destructure what they need
type TFn = (key: keyof Translations) => Translations[keyof Translations]
const LocaleContext = createContext<TFn>((k) => en[k])

export function LocaleProvider({ locale = 'en', children }: { locale?: string; children: React.ReactNode }) {
  const dict = LOCALES[locale] ?? en
  // Fallback ke en per-KEY: locale non-en yang belum punya key baru (mis. set_magic_*) balik ke
  // en, bukan undefined → UI kosong. `?? en[key]` cukup — en dijamin lengkap (Translations wajib).
  const t: TFn = (key) => dict[key] ?? en[key]
  return <LocaleContext.Provider value={t}>{children}</LocaleContext.Provider>
}

// useT returns a function: t(key) → Translations[key]
// Callers cast array keys themselves: t('processing_copy') as string[]
export const useT = () => useContext(LocaleContext)
