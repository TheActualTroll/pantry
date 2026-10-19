import type { InventoryItem } from '@pantry/core'
import { AlertTriangle, MoreHorizontal, Plus, SprayCan } from 'lucide-react'
import { StockLevelButtons } from '../StockLevelButtons'
import type { StockLevel } from '../../lib/pantry-api'
import { ProductImage } from '../scan/ProductImage'
import {
  formatExpiryBadge,
  formatKcal100g,
  formatMacroLine,
  formatQuantity,
} from '../../lib/inventory-format'
import { productDisplayImageUrl, productHasVisibleImage } from '../../lib/product-image'
import { t } from '../../i18n/index'

export function InventoryProductCard({
  item,
  today,
  busy = false,
  shoppingBusy = false,
  onQuickAdd,
  onAddStock,
  onConsume,
  onQuickConsume,
  onAddToShopping,
  onMinimum,
  onEdit,
  onCorrectUnit,
  onLots,
  onHistory,
  onChangeImage,
  onStockLevel,
  onToggleKind,
}: {
  item: InventoryItem
  today: string
  busy?: boolean
  shoppingBusy?: boolean
  onQuickAdd: () => void
  onAddStock: () => void
  onConsume: () => void
  onQuickConsume?: () => void
  onAddToShopping: () => void
  onMinimum: () => void
  onEdit?: () => void
  onCorrectUnit?: () => void
  onLots: () => void
  onHistory: () => void
  onChangeImage: () => void
  onStockLevel?: (level: StockLevel) => void
  onToggleKind?: () => void
}) {
  const nearestBadge = item.nearestExpiry ? formatExpiryBadge(item.nearestExpiry, today) : null
  const nutrition = item.product.nutrition
  const kcal = nutrition?.energyKcal100g
  const macros = nutrition ? formatMacroLine(nutrition) : null
  const locationSummary = summarizeLocations(item)
  const countUnit = item.product.unit === 'each' || item.product.unit === 'package'
  const hasImage = productHasVisibleImage(item.product)
  const imageUrl = productDisplayImageUrl(item.product)
  const imageActionLabel = hasImage ? t('Schimbă poza') : t('Adaugă poză')

  return (
    <article className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-surface">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            className="shrink-0 rounded-xl"
            onClick={onChangeImage}
            aria-label={imageActionLabel}
          >
            <ProductImage
              url={imageUrl}
              fallbackUrl={item.product.hasCustomImage ? item.product.imageUrl : null}
              name={item.product.name}
              sizeClassName="size-14"
              decorative
            />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{item.product.name}</h2>
            {item.product.brand ? <p className="mt-0.5 text-sm text-muted">{item.product.brand}</p> : null}
            {item.kind === 'household' ? (
              <span className="pill mt-1.5" data-tone="success">
                <SprayCan className="size-3.5" aria-hidden="true" />
                {t('Produs de casă')}
              </span>
            ) : null}
          </div>
        </div>
        <p className="shrink-0 rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent tabular-nums">
          {formatQuantity(item.totalQuantity, item.product.unit)}
        </p>
      </div>

      {kcal != null ? (
        <p className="mt-2 text-sm text-muted">
          {formatKcal100g(kcal)}
          {macros ? ` · ${macros}` : ''}
        </p>
      ) : null}

      {(nearestBadge && nearestBadge.status !== 'later') || item.lowStock ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {nearestBadge && nearestBadge.status !== 'later' ? (
            <span className="pill" data-tone={nearestBadge.tone}>
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
              {nearestBadge.label}
            </span>
          ) : null}
          {item.lowStock ? (
            <span className="pill" data-tone="warning">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
              {t('Stoc scăzut')}
            </span>
          ) : null}
        </div>
      ) : nearestBadge ? (
        <p className="mt-2 text-sm text-muted">{t('Expiră pe')}{' '}{nearestBadge.label}</p>
      ) : null}

      {item.lowStock ? (
        <p className="mt-1 text-sm text-muted">
          {formatQuantity(item.totalQuantity, item.product.unit)}{' '}{t('disponibili · minim')}{' '}
          {formatQuantity(item.minimumQuantity, item.product.unit)}
        </p>
      ) : null}

      {locationSummary ? <p className="mt-2 text-sm text-muted">{locationSummary}</p> : null}

      {item.kind === 'household' && onStockLevel ? (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-muted">{t('Cât a mai rămas?')}</p>
          <StockLevelButtons current={item.stockLevel} disabled={busy} onPick={onStockLevel} />
        </div>
      ) : null}

      {item.lots.length > 1 ? (
        <button
          type="button"
          className="mt-2 text-sm font-medium text-accent"
          onClick={onLots}
        >
          {item.lots.length}{' '}{t('loturi')}
          {nearestBadge
            ? ` · ${nearestBadge.status === 'later' ? t('Expiră {date}', { date: nearestBadge.label }) : nearestBadge.label}`
            : ''}
        </button>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy}
          className="flex h-touch min-h-touch min-w-touch items-center justify-center rounded-lg border border-border px-3 text-sm font-medium disabled:opacity-60"
          onClick={onQuickAdd}
          aria-label={t('Adaugă stoc')}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={busy || item.totalQuantity <= 0}
          className="flex h-touch min-h-touch flex-1 items-center justify-center rounded-lg bg-accent px-3 text-sm font-medium text-accent-foreground disabled:opacity-60"
          onClick={onConsume}
        >
          {t('Consumă')}
        </button>
        <details className="relative">
          <summary
            className="flex h-touch min-h-touch min-w-touch list-none items-center justify-center rounded-lg border border-border px-3 text-sm font-medium [&::-webkit-details-marker]:hidden"
            aria-label={t('Mai multe acțiuni')}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </summary>
          <div
            role="menu"
            className="absolute right-0 z-10 mt-1 w-56 rounded-xl border border-border bg-surface-elevated p-1 shadow-elevated"
          >
            <OverflowItem onClick={onChangeImage}>{imageActionLabel}</OverflowItem>
            {item.lowStock ? (
              <OverflowItem disabled={shoppingBusy} onClick={onAddToShopping}>
                {t('Adaugă la cumpărături')}
              </OverflowItem>
            ) : (
              <OverflowItem disabled={shoppingBusy} onClick={onAddToShopping}>
                {t('Adaugă la cumpărături')}
              </OverflowItem>
            )}
            <OverflowItem onClick={onMinimum}>{t('Stoc minim')}</OverflowItem>
            {onToggleKind ? (
              <OverflowItem onClick={onToggleKind}>
                {item.kind === 'household' ? t('Marchează ca mâncare') : t('Marchează ca produs de casă')}
              </OverflowItem>
            ) : null}
            {onEdit ? <OverflowItem onClick={onEdit}>{t('Editează produsul')}</OverflowItem> : null}
            {onCorrectUnit ? <OverflowItem onClick={onCorrectUnit}>{t('Corectează unitatea')}</OverflowItem> : null}
            <OverflowItem onClick={onLots}>{t('Loturi')}</OverflowItem>
            <OverflowItem onClick={onHistory}>{t('Istoric')}</OverflowItem>
            <OverflowItem onClick={onAddStock}>{t('Adaugă stoc')}</OverflowItem>
            {countUnit && onQuickConsume ? <OverflowItem onClick={onQuickConsume}>{t('Consumă 1')}</OverflowItem> : null}
            {countUnit ? <OverflowItem onClick={onConsume}>{t('Consumă altă cantitate')}</OverflowItem> : null}
          </div>
        </details>
      </div>
    </article>
  )
}

function OverflowItem({
  children,
  onClick,
  disabled = false,
}: {
  children: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className="flex h-touch min-h-touch w-full items-center rounded-lg px-3 text-left text-sm disabled:opacity-60"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function summarizeLocations(item: InventoryItem): string | null {
  if (item.lots.length === 0) {
    return null
  }

  const names = [...new Set(item.lots.map((lot) => lot.locationName))]
  if (names.length === 1) {
    return item.lots.length === 1
      ? names[0] ?? null
      : t('{name} · {n} loturi', { name: names[0] ?? '', n: item.lots.length })
  }

  return names.slice(0, 3).join(' · ')
}
