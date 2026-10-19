import { Outlet } from 'react-router'
import { AccountMenu } from './AccountMenu'
import { BottomNav } from './BottomNav'
import { t } from '../i18n/index'

export function AppShell() {
  return (
    <div className="min-h-dvh overflow-x-clip bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
        <header className="glass sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border/60 px-4 pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-2">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" width={28} height={28} className="size-7 rounded-lg" />
            <p className="text-base font-semibold tracking-tight">{t('Pantry')}</p>
          </div>
          <AccountMenu />
        </header>
        <main className="flex-1 px-4 pt-5 pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))]">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </div>
  )
}
