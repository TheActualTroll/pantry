import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  DomainError,
  defaultProductKind,
  isStockCheckDue,
  type NotificationKind,
  type NotificationPreferences,
  type NotificationStore,
  type ProductKind,
  type StockLevel,
  type Unit,
} from '@pantry/core'
import type { D1DatabaseLike } from './d1-like.js'

type PreferencesRow = {
  expiry_enabled: number
  low_stock_enabled: number
  stock_checks_enabled: number
  expiry_lead_days: number
  notify_hour: number
  timezone: string
}

type SubscriptionRow = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

type StockCheckRow = {
  product_id: string
  product_name: string
  unit: Unit
  total: number
  first_stocked: string | null
  stock_level: StockLevel | null
  stock_level_at: string | null
  interval_days: number
}

function newId(): string {
  return crypto.randomUUID()
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function toPreferences(row: PreferencesRow | null): NotificationPreferences {
  if (!row) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  }
  return {
    expiryEnabled: row.expiry_enabled === 1,
    lowStockEnabled: row.low_stock_enabled === 1,
    stockChecksEnabled: row.stock_checks_enabled === 1,
    expiryLeadDays: row.expiry_lead_days,
    notifyHour: row.notify_hour,
    timezone: row.timezone,
  }
}

function toSubscription(row: SubscriptionRow) {
  return { id: row.id, userId: row.user_id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }
}

const KIND_SQL = `COALESCE(m.kind, CASE WHEN p.external_catalog = 'open_products_facts' THEN 'household' ELSE 'food' END)`

export function createD1NotificationStore(db: D1DatabaseLike): NotificationStore {
  async function getPreferences(userId: string): Promise<NotificationPreferences> {
    const row = await db
      .prepare(
        `SELECT expiry_enabled, low_stock_enabled, stock_checks_enabled, expiry_lead_days, notify_hour, timezone
         FROM notification_preferences WHERE user_id = ?1`,
      )
      .bind(userId)
      .first<PreferencesRow>()
    return toPreferences(row)
  }

  return {
    getPreferences,

    async setPreferences(userId, patch) {
      const merged = { ...(await getPreferences(userId)), ...patch }
      if (
        !Number.isInteger(merged.expiryLeadDays) ||
        merged.expiryLeadDays < 0 ||
        merged.expiryLeadDays > 14 ||
        !Number.isInteger(merged.notifyHour) ||
        merged.notifyHour < 0 ||
        merged.notifyHour > 23 ||
        !isValidTimeZone(merged.timezone)
      ) {
        throw new DomainError('INVALID_PREFERENCES', 'Invalid notification preferences')
      }
      await db
        .prepare(
          `INSERT INTO notification_preferences (
             user_id, expiry_enabled, low_stock_enabled, stock_checks_enabled,
             expiry_lead_days, notify_hour, timezone, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT(user_id) DO UPDATE SET
             expiry_enabled = excluded.expiry_enabled,
             low_stock_enabled = excluded.low_stock_enabled,
             stock_checks_enabled = excluded.stock_checks_enabled,
             expiry_lead_days = excluded.expiry_lead_days,
             notify_hour = excluded.notify_hour,
             timezone = excluded.timezone,
             updated_at = excluded.updated_at`,
        )
        .bind(
          userId,
          merged.expiryEnabled ? 1 : 0,
          merged.lowStockEnabled ? 1 : 0,
          merged.stockChecksEnabled ? 1 : 0,
          merged.expiryLeadDays,
          merged.notifyHour,
          merged.timezone,
          new Date().toISOString(),
        )
        .run()
      return merged
    },

    async upsertSubscription(userId, input) {
      if (!input.endpoint.startsWith('https://') || !input.p256dh || !input.auth) {
        throw new DomainError('INVALID_PUSH_SUBSCRIPTION', 'Invalid push subscription')
      }
      const now = new Date().toISOString()
      // The endpoint is unique per browser: re-subscribing (or another user on the
      // same browser) takes it over instead of duplicating.
      await db
        .prepare(
          `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(endpoint) DO UPDATE SET
             user_id = excluded.user_id,
             p256dh = excluded.p256dh,
             auth = excluded.auth,
             user_agent = excluded.user_agent`,
        )
        .bind(newId(), userId, input.endpoint, input.p256dh, input.auth, input.userAgent?.slice(0, 200) ?? null, now)
        .run()
      const row = await db
        .prepare(`SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?1`)
        .bind(input.endpoint)
        .first<SubscriptionRow>()
      if (!row) {
        throw new Error('subscription missing after upsert')
      }
      return toSubscription(row)
    },

    async removeSubscription(input) {
      await db
        .prepare(`DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint = ?2`)
        .bind(input.userId, input.endpoint)
        .run()
    },

    async removeSubscriptionByEndpoint(endpoint) {
      await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?1`).bind(endpoint).run()
    },

    async listSubscriptions(userId) {
      const result = await db
        .prepare(`SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?1`)
        .bind(userId)
        .all<SubscriptionRow>()
      return result.results.map(toSubscription)
    },

    async markSubscriptionSuccess(endpoint) {
      await db
        .prepare(`UPDATE push_subscriptions SET last_success_at = ?2 WHERE endpoint = ?1`)
        .bind(endpoint, new Date().toISOString())
        .run()
    },

    async listSubscribedUsers() {
      const result = await db
        .prepare(
          `SELECT DISTINCT ps.user_id AS user_id, COALESCE(pr.locale, 'ro') AS locale
           FROM push_subscriptions ps
           LEFT JOIN profiles pr ON pr.id = ps.user_id`,
        )
        .all<{ user_id: string; locale: string }>()
      return result.results.map((row) => ({
        userId: row.user_id,
        locale: row.locale === 'en' ? ('en' as const) : ('ro' as const),
      }))
    },

    async markRun(userId, localDate) {
      const now = new Date().toISOString()
      await db
        .prepare(
          `INSERT INTO notification_preferences (user_id, last_run_on, updated_at)
           VALUES (?1, ?2, ?3)
           ON CONFLICT(user_id) DO UPDATE SET last_run_on = excluded.last_run_on`,
        )
        .bind(userId, localDate, now)
        .run()
    },

    async getLastRun(userId) {
      const row = await db
        .prepare(`SELECT last_run_on FROM notification_preferences WHERE user_id = ?1`)
        .bind(userId)
        .first<{ last_run_on: string | null }>()
      return row?.last_run_on ?? null
    },

    async sentKeys(userId, kind: NotificationKind) {
      const result = await db
        .prepare(`SELECT ref_key FROM notification_events WHERE user_id = ?1 AND kind = ?2`)
        .bind(userId, kind)
        .all<{ ref_key: string }>()
      return new Set(result.results.map((row) => row.ref_key))
    },

    async recordSent(userId, kind, refKeys) {
      if (refKeys.length === 0) {
        return
      }
      const now = new Date().toISOString()
      await db.batch(
        refKeys.map((key) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO notification_events (user_id, kind, ref_key, sent_at) VALUES (?1, ?2, ?3, ?4)`,
            )
            .bind(userId, kind, key, now),
        ),
      )
    },

    async pruneEvents(olderThanIso) {
      await db.prepare(`DELETE FROM notification_events WHERE sent_at < ?1`).bind(olderThanIso).run()
    },

    async listHouseholdIds(userId) {
      const result = await db
        .prepare(`SELECT household_id FROM household_members WHERE user_id = ?1`)
        .bind(userId)
        .all<{ household_id: string }>()
      return result.results.map((row) => row.household_id)
    },

    async listStockChecksDue({ householdId, now }) {
      const result = await db
        .prepare(
          `SELECT
             p.id AS product_id,
             p.name AS product_name,
             p.default_unit AS unit,
             SUM(l.quantity) AS total,
             MIN(l.created_at) AS first_stocked,
             m.stock_level AS stock_level,
             m.stock_level_at AS stock_level_at,
             COALESCE(m.check_interval_days, 14) AS interval_days
           FROM inventory_lots l
           INNER JOIN products p ON p.id = l.product_id
           LEFT JOIN household_product_meta m
             ON m.household_id = l.household_id AND m.product_id = p.id
           WHERE l.household_id = ?1
             AND ${KIND_SQL} = 'household'
           GROUP BY p.id, p.name, p.default_unit, m.stock_level, m.stock_level_at, m.check_interval_days
           ORDER BY p.normalized_name ASC`,
        )
        .bind(householdId)
        .all<StockCheckRow>()

      return result.results
        .filter((row) =>
          isStockCheckDue({
            lastCheckedAt: row.stock_level_at,
            firstStockedAt: row.first_stocked,
            intervalDays: row.interval_days,
            now,
          }),
        )
        .map((row) => ({
          householdId,
          productId: row.product_id,
          productName: row.product_name,
          unit: row.unit,
          totalQuantity: row.total,
          stockLevel: row.stock_level,
          stockLevelAt: row.stock_level_at,
        }))
    },

    async listLowStockProducts({ householdId }) {
      const result = await db
        .prepare(
          `SELECT p.id AS product_id, p.name AS product_name
           FROM inventory_settings s
           INNER JOIN products p ON p.id = s.product_id
           LEFT JOIN (
             SELECT product_id, SUM(quantity) AS total
             FROM inventory_lots
             WHERE household_id = ?1
             GROUP BY product_id
           ) t ON t.product_id = s.product_id
           WHERE s.household_id = ?1
             AND s.minimum_quantity > 0
             AND COALESCE(t.total, 0) <= s.minimum_quantity
           ORDER BY p.normalized_name ASC`,
        )
        .bind(householdId)
        .all<{ product_id: string; product_name: string }>()
      return result.results.map((row) => ({ productId: row.product_id, productName: row.product_name }))
    },

    async getProductKind({ householdId, productId }): Promise<ProductKind> {
      const row = await db
        .prepare(
          `SELECT ${KIND_SQL} AS kind
           FROM products p
           LEFT JOIN household_product_meta m ON m.household_id = ?1 AND m.product_id = p.id
           WHERE p.id = ?2 AND (p.household_id = ?1 OR p.household_id IS NULL)`,
        )
        .bind(householdId, productId)
        .first<{ kind: ProductKind }>()
      if (!row) {
        throw new DomainError('NOT_FOUND', 'Not found')
      }
      return row.kind ?? defaultProductKind(null)
    },

    async setProductKind({ householdId, productId, kind }) {
      await db
        .prepare(
          `INSERT INTO household_product_meta (household_id, product_id, kind, updated_at)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(household_id, product_id) DO UPDATE SET kind = excluded.kind, updated_at = excluded.updated_at`,
        )
        .bind(householdId, productId, kind, new Date().toISOString())
        .run()
    },

    async getFullQuantity({ householdId, productId }) {
      const row = await db
        .prepare(`SELECT full_quantity FROM household_product_meta WHERE household_id = ?1 AND product_id = ?2`)
        .bind(householdId, productId)
        .first<{ full_quantity: number | null }>()
      return row?.full_quantity ?? null
    },

    async bumpFullQuantity({ householdId, productId, quantity }) {
      if (!(quantity > 0)) {
        return
      }
      await db
        .prepare(
          `INSERT INTO household_product_meta (household_id, product_id, full_quantity, updated_at)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(household_id, product_id) DO UPDATE SET
             full_quantity = MAX(COALESCE(household_product_meta.full_quantity, 0), excluded.full_quantity),
             updated_at = excluded.updated_at`,
        )
        .bind(householdId, productId, quantity, new Date().toISOString())
        .run()
    },

    async recordStockLevel({ householdId, productId, level, fullQuantity, now }) {
      const iso = now.toISOString()
      await db
        .prepare(
          `INSERT INTO household_product_meta (
             household_id, product_id, full_quantity, stock_level, stock_level_at, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
           ON CONFLICT(household_id, product_id) DO UPDATE SET
             full_quantity = CASE
               WHEN MAX(COALESCE(household_product_meta.full_quantity, 0), COALESCE(excluded.full_quantity, 0)) > 0
               THEN MAX(COALESCE(household_product_meta.full_quantity, 0), COALESCE(excluded.full_quantity, 0))
               ELSE NULL
             END,
             stock_level = excluded.stock_level,
             stock_level_at = excluded.stock_level_at,
             updated_at = excluded.updated_at`,
        )
        .bind(householdId, productId, fullQuantity != null && fullQuantity > 0 ? fullQuantity : null, level, iso)
        .run()
    },
  }
}
