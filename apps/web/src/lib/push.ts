import { subscribePush, unsubscribePush } from './pantry-api'

export type PushSupport = 'supported' | 'unsupported'

export function pushSupport(): PushSupport {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
    ? 'supported'
    : 'unsupported'
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return pushSupport() === 'supported' ? Notification.permission : 'unsupported'
}

/** iOS only allows web push for apps added to the Home Screen. */
export function needsHomeScreenInstall(): boolean {
  const ua = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return isIos && !standalone
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }
  return bytes
}

export async function currentPushEndpoint(): Promise<string | null> {
  if (pushSupport() !== 'supported') {
    return null
  }
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  return subscription?.endpoint ?? null
}

export type EnablePushResult = 'enabled' | 'denied'

export async function enablePush(vapidPublicKey: string): Promise<EnablePushResult> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return 'denied'
  }
  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }))
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('Incomplete push subscription')
  }
  await subscribePush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  return 'enabled'
}

export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    return
  }
  await unsubscribePush(subscription.endpoint).catch(() => undefined)
  await subscription.unsubscribe()
}
