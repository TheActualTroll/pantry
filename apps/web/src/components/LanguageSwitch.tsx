import { useSyncExternalStore } from 'react'
import { getLang, LANGS, setLang, subscribeLang, t, type Lang } from '../i18n/index'
import { updateProfileLocale } from '../lib/pantry-api'

const LABELS: Record<Lang, string> = { ro: 'Română', en: 'English' }

/** Segmented control. Persists locally and, when signed in, on the profile. */
export function LanguageSwitch({ persistToProfile = false }: { persistToProfile?: boolean }) {
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang)

  function choose(next: Lang) {
    setLang(next)
    if (persistToProfile) {
      void updateProfileLocale(next).catch(() => {
        // Local choice still applies; the profile syncs on the next change.
      })
    }
  }

  return (
    <div role="group" aria-label={t('Limbă')} className="segmented">
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={lang === code}
          data-active={lang === code}
          onClick={() => choose(code)}
        >
          {LABELS[code]}
        </button>
      ))}
    </div>
  )
}
