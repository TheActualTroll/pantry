import { Outlet } from 'react-router'
import { LanguageSwitch } from './LanguageSwitch'

export function AuthLayout() {
  return (
    <div className="min-h-dvh overflow-x-clip bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-[max(1.5rem,env(safe-area-inset-top,0px))] pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]">
        <Outlet />
        <div className="mt-auto flex justify-center pt-8">
          <LanguageSwitch />
        </div>
      </div>
    </div>
  )
}
