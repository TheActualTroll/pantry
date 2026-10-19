import webpush from 'web-push'
import type { ServerConfig } from './config.js'

/** Web Push sender, or undefined when VAPID keys are not configured. */
export function createPushSender(config: ServerConfig): PushSender | undefined {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    return undefined
  }
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey)

  return async (subscription, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
        { TTL: 60 * 60 * 24, urgency: 'normal', timeout: 10_000 },
      )
      return { ok: true }
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      return { ok: false, gone: status === 404 || status === 410 }
    }
  }
}
