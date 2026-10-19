import {
  addDaysIso,
  localDateAndHour,
  planNotifications,
  type NotificationKind,
  type NotificationStore,
  type InventoryStore,
  type PushPayload,
} from '@pantry/core'

type Deps = {
  notifications: NotificationStore
  inventory: InventoryStore
  send: PushSender
}

const EVENT_RETENTION_DAYS = 120

/** Sends one payload to every subscription of the user; prunes dead endpoints. */
export async function pushToUser(
  deps: Pick<Deps, 'notifications' | 'send'>,
  userId: string,
  payload: PushPayload,
): Promise<{ delivered: number; attempted: number }> {
  const subscriptions = await deps.notifications.listSubscriptions(userId)
  const body = JSON.stringify(payload)
  let delivered = 0
  for (const subscription of subscriptions) {
    try {
      const result = await deps.send(subscription, body)
      if (result.ok) {
        delivered += 1
        await deps.notifications.markSubscriptionSuccess(subscription.endpoint)
      } else if (result.gone) {
        await deps.notifications.removeSubscriptionByEndpoint(subscription.endpoint)
      }
    } catch {
      // Transient delivery failure; the next cycle retries.
    }
  }
  return { delivered, attempted: subscriptions.length }
}

/**
 * One pass over every subscribed user. A user is processed once per local day,
 * from their chosen hour onwards, so a slow or restarted server still catches up.
 */
export async function runNotificationCycle(deps: Deps, now = new Date()): Promise<{ users: number; sent: number }> {
  const users = await deps.notifications.listSubscribedUsers()
  let sent = 0

  for (const user of users) {
    try {
      const preferences = await deps.notifications.getPreferences(user.userId)
      const local = localDateAndHour(now, preferences.timezone)
      if (local.hour < preferences.notifyHour) {
        continue
      }
      if ((await deps.notifications.getLastRun(user.userId)) === local.date) {
        continue
      }

      const householdIds = await deps.notifications.listHouseholdIds(user.userId)
      const expiring: Array<{ lotId: string; productName: string; expiresOn: string }> = []
      const lowStock = new Map<string, { productId: string; productName: string }>()
      const stockChecks: Array<{ householdId: string; productId: string; productName: string }> = []

      for (const householdId of householdIds) {
        const lots = await deps.inventory.listExpiring({
          householdId,
          today: local.date,
          days: preferences.expiryLeadDays,
        })
        for (const lot of lots) {
          expiring.push({ lotId: lot.id, productName: lot.productName, expiresOn: lot.expiresOn })
        }
        for (const item of await deps.notifications.listLowStockProducts({ householdId })) {
          lowStock.set(item.productId, item)
        }
        for (const due of await deps.notifications.listStockChecksDue({ householdId, now })) {
          stockChecks.push({ householdId, productId: due.productId, productName: due.productName })
        }
      }

      const alreadySent = new Set<string>()
      for (const kind of ['expiry', 'low_stock', 'stock_check'] as const satisfies NotificationKind[]) {
        for (const key of await deps.notifications.sentKeys(user.userId, kind)) {
          alreadySent.add(`${kind}|${key}`)
        }
      }

      const planned = planNotifications({
        today: local.date,
        locale: user.locale,
        preferences,
        expiring,
        lowStock: [...lowStock.values()],
        stockChecks,
        alreadySent,
      })

      let failed = false
      for (const notification of planned) {
        const result = await pushToUser(deps, user.userId, notification.payload)
        if (result.delivered > 0) {
          sent += 1
          await deps.notifications.recordSent(user.userId, notification.kind, notification.refKeys)
        } else if (result.attempted > 0) {
          failed = true
        }
      }

      if (!failed) {
        await deps.notifications.markRun(user.userId, local.date)
      }
    } catch {
      console.error(JSON.stringify({ message: 'notification cycle failed for a user' }))
    }
  }

  await deps.notifications.pruneEvents(addDaysIso(now.toISOString().slice(0, 10), -EVENT_RETENTION_DAYS))
  return { users: users.length, sent }
}
