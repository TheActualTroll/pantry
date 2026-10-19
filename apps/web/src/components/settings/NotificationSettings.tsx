import { BellOff, BellRing, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import { t } from '../../i18n/index'
import {
  getNotificationConfig,
  sendTestNotification,
  updateNotificationPreferences,
  type NotificationConfigResponse,
  type NotificationPreferencesView,
} from '../../lib/pantry-api'
import { mapPantryApiError } from '../../lib/pantry-api-error'
import {
  currentPushEndpoint,
  disablePush,
  enablePush,
  needsHomeScreenInstall,
  notificationPermission,
  pushSupport,
} from '../../lib/push'

const LEAD_DAY_OPTIONS = [1, 2, 3, 5, 7]
const HOUR_OPTIONS = [6, 7, 8, 9, 10, 12, 15, 18, 20]

const fieldClassName =
  'mt-1.5 h-touch min-h-touch w-full rounded-lg border border-border bg-surface px-3 text-text shadow-surface'

export function NotificationSettings() {
  const [config, setConfig] = useState<NotificationConfigResponse | null>(null)
  const [subscribedHere, setSubscribedHere] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const leadId = useId()
  const hourId = useId()

  const refresh = useCallback(async () => {
    const next = await getNotificationConfig()
    setConfig(next)
    const endpoint = await currentPushEndpoint().catch(() => null)
    setSubscribedHere(endpoint != null && next.endpoints.includes(endpoint))
  }, [])

  useEffect(() => {
    void refresh().catch((cause) => setError(mapPantryApiError(cause)))
  }, [refresh])

  async function run(work: () => Promise<void>) {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await work()
      await refresh()
    } catch (cause) {
      setError(mapPantryApiError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function savePreferences(patch: Partial<NotificationPreferencesView>) {
    await run(async () => {
      await updateNotificationPreferences(patch)
    })
  }

  if (!config) {
    return error ? (
      <p role="alert" className="mt-3 text-sm text-destructive">
        {t(error)}
      </p>
    ) : (
      <p className="mt-3 text-sm text-muted">{t('Se încarcă...')}</p>
    )
  }

  if (!config.supported) {
    return <p className="mt-3 text-sm text-muted">{t('Notificările nu sunt configurate pe acest server.')}</p>
  }

  const permission = notificationPermission()
  const unsupported = pushSupport() === 'unsupported'
  const prefs = config.preferences

  return (
    <div className="mt-3 space-y-4">
      {unsupported ? (
        <p className="text-sm text-muted">
          {needsHomeScreenInstall()
            ? t('Pe iPhone, adaugă mai întâi Pantry pe ecranul principal (Distribuie → Adaugă pe ecranul principal), apoi activează notificările.')
            : t('Acest browser nu suportă notificări push.')}
        </p>
      ) : needsHomeScreenInstall() ? (
        <p className="text-sm text-muted">
          {t('Pe iPhone, adaugă mai întâi Pantry pe ecranul principal (Distribuie → Adaugă pe ecranul principal), apoi activează notificările.')}
        </p>
      ) : permission === 'denied' ? (
        <p className="text-sm text-warning">
          {t('Notificările sunt blocate în browser. Permite-le din setările site-ului.')}
        </p>
      ) : (
        <button
          type="button"
          disabled={busy}
          className={`flex h-touch min-h-touch w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:opacity-60 ${
            subscribedHere ? 'border border-border' : 'bg-accent text-accent-foreground'
          }`}
          onClick={() =>
            void run(async () => {
              if (subscribedHere) {
                await disablePush()
                setMessage(t('Notificările sunt oprite pe acest dispozitiv.'))
                return
              }
              if (!config.vapidPublicKey) {
                return
              }
              const result = await enablePush(config.vapidPublicKey)
              setMessage(
                result === 'enabled'
                  ? t('Notificările sunt active pe acest dispozitiv.')
                  : t('Notificările sunt blocate în browser. Permite-le din setările site-ului.'),
              )
            })
          }
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : subscribedHere ? (
            <BellOff className="size-4" aria-hidden="true" />
          ) : (
            <BellRing className="size-4" aria-hidden="true" />
          )}
          {subscribedHere ? t('Oprește notificările aici') : t('Activează notificările')}
        </button>
      )}

      {config.subscriptionCount > 0 || subscribedHere ? (
        <>
          <fieldset className="space-y-1" disabled={busy}>
            <legend className="sr-only">{t('Ce alerte primești')}</legend>
            <ToggleRow
              label={t('Produse care expiră')}
              checked={prefs.expiryEnabled}
              onChange={(value) => void savePreferences({ expiryEnabled: value })}
            />
            <ToggleRow
              label={t('Stoc scăzut')}
              checked={prefs.lowStockEnabled}
              onChange={(value) => void savePreferences({ lowStockEnabled: value })}
            />
            <ToggleRow
              label={t('Verificări stoc pentru produse de casă')}
              checked={prefs.stockChecksEnabled}
              onChange={(value) => void savePreferences({ stockChecksEnabled: value })}
            />
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium" htmlFor={leadId}>
                {t('Avertizează înainte')}
              </label>
              <select
                id={leadId}
                className={fieldClassName}
                value={prefs.expiryLeadDays}
                disabled={busy}
                onChange={(event) => void savePreferences({ expiryLeadDays: Number(event.target.value) })}
              >
                {LEAD_DAY_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {t('{n} zile', { n: days })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor={hourId}>
                {t('Ora notificării')}
              </label>
              <select
                id={hourId}
                className={fieldClassName}
                value={prefs.notifyHour}
                disabled={busy}
                onChange={(event) => void savePreferences({ notifyHour: Number(event.target.value) })}
              >
                {HOUR_OPTIONS.map((hour) => (
                  <option key={hour} value={hour}>
                    {`${String(hour).padStart(2, '0')}:00`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted">{t('Fus orar: {zone}', { zone: prefs.timezone })}</p>

          <button
            type="button"
            disabled={busy || !subscribedHere}
            className="flex h-touch min-h-touch w-full items-center justify-center rounded-lg border border-border px-4 text-sm font-medium disabled:opacity-60"
            onClick={() =>
              void run(async () => {
                const result = await sendTestNotification()
                setMessage(
                  result.delivered > 0 ? t('Notificare de test trimisă.') : t('Nu am putut trimite notificarea de test.'),
                )
              })
            }
          >
            {t('Trimite o notificare de test')}
          </button>
        </>
      ) : null}

      <div role="status" className="min-h-5 text-sm text-success">
        {message}
      </div>
      <div role="alert" className="min-h-5 text-sm text-destructive">
        {error ? t(error) : null}
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex min-h-touch cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-surface-elevated px-3 text-sm font-medium">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}
