import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { en } from './en'
import { ro } from './ro'
import { getLang, setLang, t } from './index'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      return entry === 'i18n' ? [] : sourceFiles(path)
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : []
  })
}

test('every t() key used in the UI has an English translation (or is an English source string)', () => {
  const missing: string[] = []
  for (const file of sourceFiles('src')) {
    const code = readFileSync(file, 'utf8')
    for (const match of code.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
      const key = (match[1] ?? '').replace(/\\'/g, "'")
      if (!(key in en) && !(key in ro)) {
        missing.push(`${file}: ${key}`)
      }
    }
  }
  expect(missing).toEqual([])
})

test('labels passed to t() through variables are translated', () => {
  // Used as t(label) in components, so the source scan above cannot see them.
  const dynamic = ['Nimic', 'Jumătate', 'Tot', 'Inventar', 'Scan', 'Cumpărături', 'Gătește', 'buc', 'pachet', 'pachete']
  expect(dynamic.filter((key) => !(key in en))).toEqual([])
})

test('placeholders survive translation', () => {
  for (const [key, value] of Object.entries(en)) {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    expect(placeholders(value), key).toEqual(placeholders(key))
  }
})

test('t switches language and interpolates', () => {
  const original = getLang()
  setLang('en')
  expect(t('Salvează')).toBe('Save')
  expect(t('Expiră în {n} zile', { n: 3 })).toBe('Expires in 3 days')
  expect(t('Text necunoscut')).toBe('Text necunoscut')
  setLang('ro')
  expect(t('Salvează')).toBe('Salvează')
  expect(t('Primary')).toBe('Principal')
  setLang(original)
})
