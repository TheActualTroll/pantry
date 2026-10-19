import { BellRing } from 'lucide-react'
import { t } from '../../i18n/index'
import type { StockCheckDueItem, StockLevel } from '../../lib/pantry-api'
import { StockLevelButtons } from '../StockLevelButtons'

/** In-app twin of the "none / half / all" notification buttons. */
export function StockCheckCard({
  items,
  busyProductId,
  focusProductId,
  onAnswer,
}: {
  items: StockCheckDueItem[]
  busyProductId: string | null
  focusProductId: string | null
  onAnswer: (item: StockCheckDueItem, level: StockLevel) => void
}) {
  if (items.length === 0) {
    return null
  }

  const ordered = [...items].sort(
    (left, right) => Number(right.productId === focusProductId) - Number(left.productId === focusProductId),
  )

  return (
    <section className="mt-4 rounded-2xl border border-border bg-accent-soft/60 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <BellRing className="size-4 text-accent" aria-hidden="true" />
        {t('Verifică stocul')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('Cât a mai rămas din produsele de casă?')}</p>
      <ul className="mt-3 space-y-3">
        {ordered.slice(0, 5).map((item) => (
          <li key={item.productId}>
            <p className="mb-1.5 text-sm font-medium">{item.productName}</p>
            <StockLevelButtons
              current={null}
              disabled={busyProductId === item.productId}
              onPick={(level) => onAnswer(item, level)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
