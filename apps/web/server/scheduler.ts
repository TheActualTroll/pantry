import { createD1InventoryStore, createD1NotificationStore } from '@pantry/database/d1'
import { runNotificationCycle } from '../worker/notifications/run.js'

const TICK_MS = 15 * 60 * 1000

/**
 * Wakes every 15 minutes; each user is handled once per local day from their
 * chosen hour, so restarts and missed ticks only delay a notification.
 */
export function startNotificationScheduler(input: {
  db: D1Database
  send: PushSender | undefined
}): () => void {
  const { send } = input
  if (!send) {
    console.log(JSON.stringify({ message: 'push notifications disabled (no VAPID keys)' }))
    return () => {}
  }

  const sender: PushSender = send
  let running = false
  async function tick() {
    if (running) {
      return
    }
    running = true
    try {
      const result = await runNotificationCycle({
        notifications: createD1NotificationStore(input.db),
        inventory: createD1InventoryStore(input.db),
        send: sender,
      })
      if (result.sent > 0) {
        console.log(JSON.stringify({ message: 'notifications sent', ...result }))
      }
    } catch {
      console.error(JSON.stringify({ message: 'notification cycle failed' }))
    } finally {
      running = false
    }
  }

  const first = setTimeout(() => void tick(), 30_000)
  const timer = setInterval(() => void tick(), TICK_MS)
  first.unref()
  timer.unref()
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
