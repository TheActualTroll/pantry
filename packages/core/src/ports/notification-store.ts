import type { NotificationKind, NotificationPreferences } from '../notification/plan.js'
import type { ProductKind, StockLevel } from '../notification/stock-level.js'
import type { Unit } from '../product/units.js'

export type PushSubscriptionInput = {
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string | null
}

export type PushSubscriptionRecord = {
  id: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
}

export type StockCheckDue = {
  householdId: string
  productId: string
  productName: string
  unit: Unit
  totalQuantity: number
  stockLevel: StockLevel | null
  stockLevelAt: string | null
}

export type NotificationStore = {
  getPreferences(userId: string): Promise<NotificationPreferences>
  setPreferences(userId: string, patch: Partial<NotificationPreferences>): Promise<NotificationPreferences>
  upsertSubscription(userId: string, input: PushSubscriptionInput): Promise<PushSubscriptionRecord>
  removeSubscription(input: { userId: string; endpoint: string }): Promise<void>
  removeSubscriptionByEndpoint(endpoint: string): Promise<void>
  listSubscriptions(userId: string): Promise<PushSubscriptionRecord[]>
  markSubscriptionSuccess(endpoint: string): Promise<void>
  /** Users with at least one subscription, with their stored locale. */
  listSubscribedUsers(): Promise<Array<{ userId: string; locale: 'ro' | 'en' }>>
  markRun(userId: string, localDate: string): Promise<void>
  getLastRun(userId: string): Promise<string | null>
  sentKeys(userId: string, kind: NotificationKind): Promise<Set<string>>
  recordSent(userId: string, kind: NotificationKind, refKeys: string[]): Promise<void>
  pruneEvents(olderThanIso: string): Promise<void>
  listHouseholdIds(userId: string): Promise<string[]>
  listStockChecksDue(input: { householdId: string; now: Date }): Promise<StockCheckDue[]>
  listLowStockProducts(input: { householdId: string }): Promise<Array<{ productId: string; productName: string }>>
  getProductKind(input: { householdId: string; productId: string }): Promise<ProductKind>
  setProductKind(input: { householdId: string; productId: string; kind: ProductKind }): Promise<void>
  getFullQuantity(input: { householdId: string; productId: string }): Promise<number | null>
  bumpFullQuantity(input: { householdId: string; productId: string; quantity: number }): Promise<void>
  recordStockLevel(input: {
    householdId: string
    productId: string
    level: StockLevel
    fullQuantity: number | null
    now: Date
  }): Promise<void>
}
