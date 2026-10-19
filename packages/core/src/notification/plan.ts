import { addDaysIso, calendarDaysBetween } from '../inventory/expiry.js'
import type { StockLevel } from './stock-level.js'

export type NotificationLocale = 'ro' | 'en'
export type NotificationKind = 'expiry' | 'low_stock' | 'stock_check'

export type NotificationPreferences = {
  expiryEnabled: boolean
  lowStockEnabled: boolean
  stockChecksEnabled: boolean
  expiryLeadDays: number
  notifyHour: number
  timezone: string
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  expiryEnabled: true,
  lowStockEnabled: true,
  stockChecksEnabled: true,
  expiryLeadDays: 3,
  notifyHour: 9,
  timezone: 'UTC',
}

export type PushAction = { action: StockLevel; title: string }

export type PushPayload = {
  title: string
  body: string
  /** Replaces an earlier notification with the same tag. */
  tag: string
  /** In-app path opened when the notification body is tapped. */
  url: string
  actions?: PushAction[]
  data: {
    kind: NotificationKind
    /** Lets the service worker word its confirmation without a round trip. */
    lang: NotificationLocale
    householdId?: string
    productId?: string
    productName?: string
  }
}

export type PlannedNotification = {
  kind: NotificationKind
  /** Recorded after sending so the same item is not announced again. */
  refKeys: string[]
  payload: PushPayload
}

export type ExpiringCandidate = {
  lotId: string
  productName: string
  expiresOn: string
}

export type LowStockCandidate = {
  productId: string
  productName: string
}

export type StockCheckCandidate = {
  householdId: string
  productId: string
  productName: string
}

export const MAX_STOCK_CHECKS_PER_RUN = 3
const MAX_NAMES_IN_BODY = 3

type Messages = {
  expiryTitle: (count: number) => string
  expiryToday: string
  expiryTomorrow: string
  expiryIn: (days: number) => string
  expiryExpired: string
  lowStockTitle: (count: number) => string
  lowStockBody: string
  stockCheckTitle: (name: string) => string
  stockCheckBody: string
  levelNone: string
  levelHalf: string
  levelFull: string
  more: (count: number) => string
  and: string
}

const MESSAGES: Record<NotificationLocale, Messages> = {
  ro: {
    expiryTitle: (count) => (count === 1 ? 'Un produs expiră curând' : `${count} produse expiră curând`),
    expiryToday: 'azi',
    expiryTomorrow: 'mâine',
    expiryIn: (days) => `în ${days} zile`,
    expiryExpired: 'expirat',
    lowStockTitle: (count) => (count === 1 ? 'Stoc scăzut' : `${count} produse cu stoc scăzut`),
    lowStockBody: 'Adaugă-le pe lista de cumpărături.',
    stockCheckTitle: (name) => `Cât mai ai din ${name}?`,
    stockCheckBody: 'Alege: nimic sau tot. Pentru jumătate, deschide aplicația.',
    levelNone: 'Nimic',
    levelHalf: 'Jumătate',
    levelFull: 'Tot',
    more: (count) => `încă ${count}`,
    and: 'și',
  },
  en: {
    expiryTitle: (count) => (count === 1 ? 'One item is expiring soon' : `${count} items are expiring soon`),
    expiryToday: 'today',
    expiryTomorrow: 'tomorrow',
    expiryIn: (days) => `in ${days} days`,
    expiryExpired: 'expired',
    lowStockTitle: (count) => (count === 1 ? 'Running low' : `${count} items running low`),
    lowStockBody: 'Add them to your shopping list.',
    stockCheckTitle: (name) => `How much ${name} is left?`,
    stockCheckBody: 'Pick: none or all. For half, open the app.',
    levelNone: 'None',
    levelHalf: 'Half',
    levelFull: 'All',
    more: (count) => `${count} more`,
    and: 'and',
  },
}

export function stockLevelLabel(level: StockLevel, locale: NotificationLocale): string {
  const messages = MESSAGES[locale]
  return level === 'none' ? messages.levelNone : level === 'half' ? messages.levelHalf : messages.levelFull
}

function epochWeek(today: string): number {
  return Math.floor(calendarDaysBetween('1970-01-01', today) / 7)
}

function joinNames(names: string[], extra: number, messages: Messages): string {
  const shown = names.slice(0, MAX_NAMES_IN_BODY)
  const remaining = names.length - shown.length + extra
  if (remaining > 0) {
    return `${shown.join(', ')} ${messages.and} ${messages.more(remaining)}`
  }
  if (shown.length > 1) {
    return `${shown.slice(0, -1).join(', ')} ${messages.and} ${shown[shown.length - 1]}`
  }
  return shown[0] ?? ''
}

function expiryStage(expiresOn: string, today: string): 'expired' | 'today' | 'soon' {
  if (expiresOn < today) {
    return 'expired'
  }
  return expiresOn === today ? 'today' : 'soon'
}

function describeExpiry(expiresOn: string, today: string, messages: Messages): string {
  const days = calendarDaysBetween(today, expiresOn)
  if (days < 0) {
    return messages.expiryExpired
  }
  if (days === 0) {
    return messages.expiryToday
  }
  if (days === 1) {
    return messages.expiryTomorrow
  }
  return messages.expiryIn(days)
}

/**
 * Decides what to push for one user on one run. Pure: the caller loads the
 * candidates and the already-sent keys, then records `refKeys` after sending.
 */
export function planNotifications(input: {
  today: string
  locale: NotificationLocale
  preferences: Pick<
    NotificationPreferences,
    'expiryEnabled' | 'lowStockEnabled' | 'stockChecksEnabled' | 'expiryLeadDays'
  >
  expiring: ExpiringCandidate[]
  lowStock: LowStockCandidate[]
  stockChecks: StockCheckCandidate[]
  /** `${kind}|${refKey}` for everything already sent. */
  alreadySent: ReadonlySet<string>
}): PlannedNotification[] {
  const messages = MESSAGES[input.locale]
  const planned: PlannedNotification[] = []
  const week = epochWeek(input.today)

  if (input.preferences.expiryEnabled) {
    const horizon = addDaysIso(input.today, input.preferences.expiryLeadDays)
    const fresh = input.expiring
      .filter((lot) => lot.expiresOn <= horizon)
      .map((lot) => ({
        lot,
        key: `${lot.lotId}:${lot.expiresOn}:${expiryStage(lot.expiresOn, input.today)}`,
      }))
      .filter(({ key }) => !input.alreadySent.has(`expiry|${key}`))
      .sort((left, right) => left.lot.expiresOn.localeCompare(right.lot.expiresOn))

    if (fresh.length > 0) {
      const shown = fresh.slice(0, MAX_NAMES_IN_BODY)
      const body = shown
        .map(({ lot }) => `${lot.productName} (${describeExpiry(lot.expiresOn, input.today, messages)})`)
        .join(', ')
      const extra = fresh.length - shown.length
      planned.push({
        kind: 'expiry',
        refKeys: fresh.map(({ key }) => key),
        payload: {
          title: messages.expiryTitle(fresh.length),
          body: extra > 0 ? `${body} ${messages.and} ${messages.more(extra)}` : body,
          tag: 'pantry-expiry',
          url: '/inventory',
          data: { kind: 'expiry', lang: input.locale },
        },
      })
    }
  }

  if (input.preferences.lowStockEnabled) {
    const fresh = input.lowStock
      .map((item) => ({ item, key: `${item.productId}:${week}` }))
      .filter(({ key }) => !input.alreadySent.has(`low_stock|${key}`))

    if (fresh.length > 0) {
      planned.push({
        kind: 'low_stock',
        refKeys: fresh.map(({ key }) => key),
        payload: {
          title: messages.lowStockTitle(fresh.length),
          body: `${joinNames(
            fresh.map(({ item }) => item.productName),
            0,
            messages,
          )}. ${messages.lowStockBody}`,
          tag: 'pantry-low-stock',
          url: '/inventory',
          data: { kind: 'low_stock', lang: input.locale },
        },
      })
    }
  }

  if (input.preferences.stockChecksEnabled) {
    const fresh = input.stockChecks
      .map((check) => ({ check, key: `${check.productId}:${week}` }))
      .filter(({ key }) => !input.alreadySent.has(`stock_check|${key}`))
      .slice(0, MAX_STOCK_CHECKS_PER_RUN)

    for (const { check, key } of fresh) {
      planned.push({
        kind: 'stock_check',
        refKeys: [key],
        payload: {
          title: messages.stockCheckTitle(check.productName),
          body: messages.stockCheckBody,
          tag: `pantry-stock-${check.productId}`,
          url: `/inventory?stockCheck=${encodeURIComponent(check.productId)}`,
          actions: (['none', 'full'] as const).map((level) => ({
            action: level,
            title: stockLevelLabel(level, input.locale),
          })),
          data: {
            kind: 'stock_check',
            lang: input.locale,
            householdId: check.householdId,
            productId: check.productId,
            productName: check.productName,
          },
        },
      })
    }
  }

  return planned
}

/** Local calendar date and hour for a user's timezone (falls back to UTC). */
export function localDateAndHour(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)

  let resolved: Intl.DateTimeFormatPart[]
  try {
    resolved = parts(timeZone)
  } catch {
    resolved = parts('UTC')
  }
  const get = (type: string) => resolved.find((part) => part.type === type)?.value ?? '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 }
}
