import { en } from './en'
import { ro } from './ro'

export type Lang = 'ro' | 'en'
export const LANGS: readonly Lang[] = ['ro', 'en']

const STORAGE_KEY = 'pantry.lang'

/**
 * Source strings in the UI are written in Romanian. `en` maps them to English;
 * `ro` maps the few English source strings back. Unknown keys render as-is, so
 * a missing translation never breaks a screen.
 */
function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'ro' || stored === 'en') {
      return stored
    }
  } catch {
    // Storage can be blocked; fall through to the default.
  }
  return 'ro'
}

let current: Lang = typeof localStorage === 'undefined' ? 'ro' : readStoredLang()
const listeners = new Set<() => void>()

export function hasStoredLang(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'ro' || stored === 'en'
  } catch {
    return false
  }
}

export function getLang(): Lang {
  return current
}

export function isLang(value: unknown): value is Lang {
  return value === 'ro' || value === 'en'
}

export function setLang(lang: Lang): void {
  if (lang === current) {
    return
  }
  current = lang
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Non-fatal: the choice just will not persist on this device.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang
  }
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function t(key: string, params?: Record<string, string | number>): string {
  const table = current === 'en' ? en : ro
  const template = table[key] ?? key
  if (!params) {
    return template
  }
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}

/** BCP-47 tag for Intl formatting in the active language. */
export function intlLocale(): string {
  return current === 'en' ? 'en-GB' : 'ro-RO'
}

/** Formatter cache keyed by language so switching never reuses stale locales. */
const formatterCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()

export function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n:${current}:${JSON.stringify(options)}`
  let formatter = formatterCache.get(key) as Intl.NumberFormat | undefined
  if (!formatter) {
    formatter = new Intl.NumberFormat(intlLocale(), options)
    formatterCache.set(key, formatter)
  }
  return formatter
}

export function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d:${current}:${JSON.stringify(options)}`
  let formatter = formatterCache.get(key) as Intl.DateTimeFormat | undefined
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(intlLocale(), options)
    formatterCache.set(key, formatter)
  }
  return formatter
}
