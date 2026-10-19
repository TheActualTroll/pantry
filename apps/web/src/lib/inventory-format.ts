import {
  classifyExpiry,
  lotQuickAddStep,
  type ExpiryStatus,
  type InventoryHistoryEntry,
  type InventoryItem,
  type InventoryLotRecord,
  type ProductNutrition,
} from '@pantry/core'
import type { Unit } from '@pantry/shared'
import { dateFormat, numberFormat, t } from '../i18n/index'

const UNIT_LABELS: Record<Unit, { one: string; other: string }> = {
  g: { one: 'g', other: 'g' },
  ml: { one: 'ml', other: 'ml' },
  each: { one: 'buc', other: 'buc' },
  package: { one: 'pachet', other: 'pachete' },
}

// Resolved per call so a language switch is picked up immediately.
const numberFormatter = { format: (value: number) => numberFormat({ maximumFractionDigits: 3 }).format(value) }
const nutrientFormatter = { format: (value: number) => numberFormat({ maximumFractionDigits: 2 }).format(value) }
const timeFormatter = { format: (value: Date) => dateFormat({ hour: '2-digit', minute: '2-digit' }).format(value) }
const dayMonthFormatter = { format: (value: Date) => dateFormat({ day: 'numeric', month: 'long' }).format(value) }

export function unitLabel(unit: Unit, quantity = 2): string {
  const labels = UNIT_LABELS[unit]
  return t(quantity === 1 ? labels.one : labels.other)
}

export function formatQuantity(quantity: number, unit: Unit): string {
  return `${numberFormatter.format(quantity)} ${unitLabel(unit, quantity)}`
}

export function formatSignedQuantity(quantity: number, unit: Unit): string {
  const formatted = formatQuantity(Math.abs(quantity), unit)
  if (quantity > 0) {
    return `+${formatted}`
  }
  if (quantity < 0) {
    return `−${formatted}`
  }
  return formatted
}

export function formatDayMonthRo(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) {
    return isoDate
  }

  return dateFormat({
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

export function formatDayMonthYearRo(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) {
    return isoDate
  }

  return dateFormat({
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

export function localIsoDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatExpiryHeadline(isoDate: string, today = localIsoDate()): string {
  return formatExpiryBadge(isoDate, today)?.label ?? t('Expiră pe {date}', { date: formatDayMonthRo(isoDate) })
}

export function formatLotExpiry(isoDate: string | null): string {
  return isoDate ? formatDayMonthRo(isoDate) : t('fără expirare')
}

export function formatLotExpiryLine(isoDate: string | null, today = localIsoDate()): string {
  if (!isoDate) {
    return t('Fără expirare')
  }

  const badge = formatExpiryBadge(isoDate, today)
  if (badge?.status === 'expired') {
    return t('Expirat')
  }
  if (badge?.status === 'today') {
    return t('Expiră azi')
  }
  if (badge?.status === 'tomorrow') {
    return t('Expiră mâine')
  }

  return t('Expiră: {date}', { date: formatDayMonthYearRo(isoDate) })
}

export function catalogStockSuggestionHint(quantity: number, unit: Unit): string {
  return t('Sugestie catalog: {quantity}. Verifică cantitatea înainte de a salva.', { quantity: formatQuantity(quantity, unit) })
}

export function lotPlusButtonLabel(item: InventoryItem): string {
  const step = lotQuickAddStep(item.product)
  if (step?.asPackage) {
    return t('+ 1 pachet ({quantity})', { quantity: formatQuantity(step.quantity, item.product.unit) })
  }
  return t('Adaugă în acest lot')
}

export type ExpiryBadge = {
  status: Exclude<ExpiryStatus, 'none'>
  label: string
  tone: 'danger' | 'warning' | 'muted'
}

export function formatExpiryBadge(isoDate: string | null, today = localIsoDate()): ExpiryBadge | null {
  const status = classifyExpiry(isoDate, today)
  if (status === 'none' || !isoDate) {
    return null
  }

  if (status === 'expired') {
    return { status, label: t('Expirat'), tone: 'danger' }
  }
  if (status === 'today') {
    return { status, label: t('Expiră azi'), tone: 'warning' }
  }
  if (status === 'tomorrow') {
    return { status, label: t('Expiră mâine'), tone: 'warning' }
  }
  if (status === 'soon') {
    const [year, month, day] = isoDate.split('-').map(Number)
    const [ty, tm, td] = today.split('-').map(Number)
    const remaining = Math.round(
      (Date.UTC(year, month - 1, day) - Date.UTC(ty, tm - 1, td)) / 86_400_000,
    )
    return { status, label: t('Expiră în {n} zile', { n: remaining }), tone: 'warning' }
  }

  return { status, label: formatDayMonthRo(isoDate), tone: 'muted' }
}

export function isExpirySoon(isoDate: string, today = localIsoDate()): boolean {
  const status = classifyExpiry(isoDate, today)
  return status === 'today' || status === 'tomorrow' || status === 'soon'
}

export function isExpired(isoDate: string, today = localIsoDate()): boolean {
  return classifyExpiry(isoDate, today) === 'expired'
}

export function formatKcal100g(kcal: number): string {
  return `${nutrientFormatter.format(kcal)} kcal / 100 g`
}

export function formatMacroLine(nutrition: ProductNutrition): string | null {
  const parts: string[] = []
  if (nutrition.proteinG100g != null) {
    parts.push(`P ${nutrientFormatter.format(nutrition.proteinG100g)} g`)
  }
  if (nutrition.carbohydratesG100g != null) {
    parts.push(`C ${nutrientFormatter.format(nutrition.carbohydratesG100g)} g`)
  }
  if (nutrition.fatG100g != null) {
    parts.push(`G ${nutrientFormatter.format(nutrition.fatG100g)} g`)
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

export function quickAddLot(item: InventoryItem, locationId: string): InventoryLotRecord | null {
  const match = item.lots.filter((lot) => lot.locationId === locationId && lot.expiresOn === null)
  return match.length === 1 ? (match[0] ?? null) : null
}

export function formatHistoryWhen(isoTimestamp: string, now = new Date()): string {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp
  }

  const today = localIsoDate(now)
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = localIsoDate(yesterdayDate)
  const stampDate = localIsoDate(date)
  const time = timeFormatter.format(date)

  if (stampDate === today) {
    return t('astăzi, {time}', { time })
  }
  if (stampDate === yesterday) {
    return t('ieri, {time}', { time })
  }

  return `${dayMonthFormatter.format(date)}, ${time}`
}

export function formatHistoryHeadline(entry: InventoryHistoryEntry): string {
  const qty = formatSignedQuantity(entry.deltaQuantity, entry.unit)
  if (entry.action === 'adjust') {
    return t('Corectat · {qty} {name}', { qty, name: entry.productName })
  }
  if (entry.action === 'move') {
    return t('Mutat · {qty} {name}', { qty, name: entry.productName })
  }
  if (entry.action === 'edit') {
    if (entry.deltaQuantity === 0) {
      return t('Editat · {name}', { name: entry.productName })
    }
    return t('Editat · {qty} {name}', { qty, name: entry.productName })
  }
  return `${qty} ${entry.productName}`
}

export type InventoryStatusFilter = 'all' | 'low' | 'soon' | 'expired'

export function itemMatchesStatusFilter(
  item: InventoryItem,
  filter: InventoryStatusFilter,
  today = localIsoDate(),
): boolean {
  if (filter === 'all') {
    return true
  }
  if (filter === 'low') {
    return item.lowStock
  }
  if (filter === 'expired') {
    return item.lots.some((lot) => lot.expiresOn != null && isExpired(lot.expiresOn, today))
  }
  return item.lots.some((lot) => lot.expiresOn != null && isExpirySoon(lot.expiresOn, today))
}

export type AttentionCard = {
  productId: string
  name: string
  reason: 'expired' | 'soon' | 'low'
  detail: string
}

export function attentionCards(items: InventoryItem[], today = localIsoDate(), limit = 5): AttentionCard[] {
  const expired: AttentionCard[] = []
  const soon: AttentionCard[] = []
  const low: AttentionCard[] = []

  for (const item of items) {
    const expiredLot = item.lots
      .filter((lot) => lot.expiresOn && isExpired(lot.expiresOn, today))
      .sort((left, right) => (left.expiresOn ?? '').localeCompare(right.expiresOn ?? ''))[0]
    if (expiredLot?.expiresOn) {
      expired.push({
        productId: item.product.id,
        name: item.product.name,
        reason: 'expired',
        detail: formatExpiryBadge(expiredLot.expiresOn, today)?.label ?? t('Expirat'),
      })
      continue
    }

    const soonLot = item.lots
      .filter((lot) => lot.expiresOn && isExpirySoon(lot.expiresOn, today))
      .sort((left, right) => (left.expiresOn ?? '').localeCompare(right.expiresOn ?? ''))[0]
    if (soonLot?.expiresOn) {
      soon.push({
        productId: item.product.id,
        name: item.product.name,
        reason: 'soon',
        detail: formatExpiryBadge(soonLot.expiresOn, today)?.label ?? t('Expiră curând'),
      })
      continue
    }

    if (item.lowStock) {
      low.push({
        productId: item.product.id,
        name: item.product.name,
        reason: 'low',
        detail: t('{available} disponibili · minim {minimum}', {
          available: formatQuantity(item.totalQuantity, item.product.unit),
          minimum: formatQuantity(item.minimumQuantity, item.product.unit),
        }),
      })
    }
  }

  return [...expired, ...soon, ...low].slice(0, limit)
}
