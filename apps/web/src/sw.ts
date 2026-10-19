/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

type StockAction = 'none' | 'half' | 'full'

type PushData = {
  kind?: 'expiry' | 'low_stock' | 'stock_check'
  lang?: 'ro' | 'en'
  householdId?: string
  productId?: string
  productName?: string
  url?: string
}

type PushPayload = {
  title: string
  body: string
  tag: string
  url: string
  actions?: Array<{ action: StockAction; title: string }>
  data?: PushData
}

const COPY = {
  ro: {
    saved: 'Salvat',
    levels: { none: 'Nimic', half: 'Jumătate', full: 'Tot' },
  },
  en: {
    saved: 'Saved',
    levels: { none: 'None', half: 'Half', full: 'All' },
  },
} as const

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
// App shell for client-side routes; the API always goes to the network.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }))

/** Only "none" and "all" as buttons: fewer chances of an accidental tap. "Half" is answered in the app. */
function fitActions(actions: PushPayload['actions']): PushPayload['actions'] {
  return actions?.filter((action) => action.action !== 'half').slice(0, 2)
}

self.addEventListener('push', (event) => {
  if (!event.data) {
    return
  }
  let payload: PushPayload
  try {
    payload = event.data.json() as PushPayload
  } catch {
    return
  }

  const options: NotificationOptions & { actions?: unknown; renotify?: boolean } = {
    body: payload.body,
    tag: payload.tag,
    icon: '/pwa-192x192.png',
    badge: '/favicon-48x48.png',
    data: { ...payload.data, url: payload.url },
    actions: fitActions(payload.actions),
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(payload.title, options))
})

async function respondToStockCheck(data: PushData, level: StockAction): Promise<boolean> {
  if (!data.productId) {
    return false
  }
  try {
    const response = await fetch(`/api/v1/stock-checks/${encodeURIComponent(data.productId)}/respond`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level, householdId: data.householdId }),
    })
    return response.ok
  } catch {
    return false
  }
}

async function openApp(url: string): Promise<void> {
  const target = new URL(url, self.location.origin).href
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of windows) {
    if ('focus' in client) {
      await client.focus()
      if ('navigate' in client) {
        await (client as WindowClient).navigate(target).catch(() => undefined)
      }
      return
    }
  }
  await self.clients.openWindow(target)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = (event.notification.data ?? {}) as PushData
  const action = event.action as StockAction | ''

  if (data.kind === 'stock_check' && (action === 'none' || action === 'half' || action === 'full')) {
    event.waitUntil(
      (async () => {
        const copy = COPY[data.lang === 'en' ? 'en' : 'ro']
        if (await respondToStockCheck(data, action)) {
          await self.registration.showNotification(`${copy.saved}: ${data.productName ?? ''}`.trim(), {
            body: copy.levels[action],
            tag: event.notification.tag,
            icon: '/pwa-192x192.png',
            silent: true,
          })
          return
        }
        // Signed out, offline, or the server refused: let the person answer in the app.
        await openApp(data.url ?? '/inventory')
      })(),
    )
    return
  }

  event.waitUntil(openApp(data.url ?? '/inventory'))
})
