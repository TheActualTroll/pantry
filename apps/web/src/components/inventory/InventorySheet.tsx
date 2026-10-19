import { useEffect, useId, useRef, type ReactNode } from 'react'
import { t } from '../../i18n/index'

export function InventorySheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="sheet-backdrop absolute inset-0 bg-black/45"
        aria-label={t('Închide')}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="sheet-panel relative z-10 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-[1.75rem] bg-surface-elevated p-5 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] shadow-elevated sm:mx-4 sm:rounded-[1.75rem]"
      >
        <div aria-hidden="true" className="mx-auto -mt-1 mb-3 h-1.5 w-10 rounded-full bg-border sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            className="flex min-h-touch min-w-touch items-center justify-center rounded-full px-2 text-sm font-medium text-muted"
            onClick={onClose}
          >
            {t('Închide')}
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
