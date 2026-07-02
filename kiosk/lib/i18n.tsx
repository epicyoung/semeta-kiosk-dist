'use client'
import React, { createContext, useContext } from 'react'
import type { Translations } from './locales/types'
import en from './locales/en'
import id from './locales/id'
import mythEn from './locales/myth-en'
import mythId from './locales/myth-id'

type LocaleDict = Record<string, Translations>
const LOCALES: LocaleDict = { en, id, 'myth-en': mythEn, 'myth-id': mythId }

// Returns the full dict — callers destructure what they need
type TFn = (key: keyof Translations) => Translations[keyof Translations]
const LocaleContext = createContext<TFn>((k) => en[k])

export function LocaleProvider({ locale = 'en', children }: { locale?: string; children: React.ReactNode }) {
  const dict = LOCALES[locale] ?? en
  const t: TFn = (key) => dict[key]
  return <LocaleContext.Provider value={t}>{children}</LocaleContext.Provider>
}

// useT returns a function: t(key) → Translations[key]
// Callers cast array keys themselves: t('processing_copy') as string[]
export const useT = () => useContext(LocaleContext)
