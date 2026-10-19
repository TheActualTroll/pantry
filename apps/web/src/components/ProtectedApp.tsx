import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { getLang, hasStoredLang, isLang, setLang } from '../i18n/index'
import { getProfile, updateProfileLocale } from '../lib/pantry-api'
import { authClient } from '../lib/auth-client'
import { SessionLoading } from './SessionLoading'

export function ProtectedApp() {
  const location = useLocation()
  const { data: session, isPending } = authClient.useSession()
  const userId = session?.user?.id

  // The profile locale is the source of truth across devices, unless this
  // device already has an explicit choice (then that choice is synced up).
  useEffect(() => {
    if (!userId) {
      return
    }
    let cancelled = false
    void getProfile()
      .then((profile) => {
        if (cancelled) {
          return
        }
        if (hasStoredLang()) {
          if (profile.locale !== getLang()) {
            void updateProfileLocale(getLang()).catch(() => {})
          }
        } else if (isLang(profile.locale)) {
          setLang(profile.locale)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [userId])

  if (isPending) {
    return (
      <SessionLoading className="flex min-h-dvh flex-col items-center justify-center bg-background" />
    )
  }

  if (!session?.user) {
    return (
      <Navigate
        replace
        to="/login"
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }

  return <Outlet />
}
