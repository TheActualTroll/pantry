import { NavLink } from 'react-router'
import { navItems } from '../navigation'
import { t } from '../i18n/index'

function navClassName(isActive: boolean) {
  const base =
    'flex h-full min-h-touch w-full min-w-0 flex-col items-center justify-end gap-0.5 rounded-xl px-0.5 text-[0.6875rem] leading-tight tracking-tight transition-colors'

  return `${base} ${isActive ? 'font-semibold text-accent' : 'text-muted'}`
}

export function BottomNav() {
  return (
    <nav
      aria-label={t('Primary')}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]"
    >
      <ul className="glass pointer-events-auto mx-auto grid w-full max-w-lg grid-cols-4 items-end rounded-[1.75rem] border border-border/70 px-1.5 pt-1.5 shadow-elevated">
        {navItems.map((item) => {
          const Icon = item.icon
          const prominent = item.prominent === true

          return (
            <li key={item.to} className="min-w-0">
              <NavLink
                to={item.to}
                className={({ isActive }) => navClassName(isActive)}
              >
                {prominent ? (
                  <span className="-mt-5 flex size-14 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-elevated ring-4 ring-background">
                    <Icon aria-hidden="true" className="size-6" />
                  </span>
                ) : (
                  <Icon aria-hidden="true" className="size-5 shrink-0" />
                )}
                <span className="w-full truncate pb-1 text-center">{t(item.label)}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
