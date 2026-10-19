import { Fragment, useSyncExternalStore, type ReactNode } from 'react'
import { getLang, subscribeLang } from './index'

/** Remounts the tree on language change so every `t()` call re-evaluates. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang)
  return <Fragment key={lang}>{children}</Fragment>
}
