import {
  addDaysIso,
  validateProductName,
  validateQuantity,
  type LocationRecord,
  type ProductRecord,
  type Unit,
} from '@pantry/core'
import { CheckCheck, LoaderCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { localIsoDate, unitLabel } from '../../lib/inventory-format'
import { mapPantryApiError } from '../../lib/pantry-api-error'
import {
  addStock,
  createProduct,
  setProductKind,
  type ProductKind,
  type ReceiptDraftLineView,
  type ReceiptExtractResponse,
} from '../../lib/pantry-api'
import { t } from '../../i18n/index'

const fieldClassName =
  'mt-1.5 h-touch min-h-touch w-full rounded-lg border border-border bg-surface px-3 text-text shadow-surface'

const UNIT_OPTIONS: Array<{ value: Unit; label: string }> = [
  { value: 'g', label: 'g' },
  { value: 'ml', label: 'ml' },
  { value: 'each', label: 'buc' },
  { value: 'package', label: 'pachet' },
]

type ReviewLine = {
  key: string
  included: boolean
  name: string
  quantity: string
  unit: Unit
  kind: ProductKind
  locationId: string
  expiresOn: string
  productId: string | null
  matchName: string | null
  confidence: number | null
  lineTotal: number | null
  status: 'idle' | 'ok' | 'error'
  error: string | null
}

const FOOD_LOCATION = /frigider|fridge|refrigerator/i
const HOUSEHOLD_LOCATION = /cămar|camar|pantry|dulap|cabinet|cupboard|depozit|closet|baie|bath/i

/** Food goes to the fridge, household goods to a cupboard, when such places exist. */
export function pickLocationId(locations: LocationRecord[], kind: ProductKind): string {
  const preferred = locations.find((location) =>
    (kind === 'food' ? FOOD_LOCATION : HOUSEHOLD_LOCATION).test(location.name),
  )
  return preferred?.id ?? locations[0]?.id ?? ''
}

/** Purchase date for shelf-life maths: the receipt date unless it is stale or in the future. */
function purchaseBase(receiptDate: string | null, today: string): string {
  if (!receiptDate || receiptDate > today || receiptDate < addDaysIso(today, -3)) {
    return today
  }
  return receiptDate
}

function toReviewLines(
  items: ReceiptDraftLineView[],
  locations: LocationRecord[],
  receiptDate: string | null,
): ReviewLine[] {
  const today = localIsoDate()
  const base = purchaseBase(receiptDate, today)
  return items.map((item, index) => {
    const kind: ProductKind = item.category === 'household' ? 'household' : 'food'
    const expiresOn =
      item.shelfLifeDays != null && item.shelfLifeDays > 0 && kind === 'food'
        ? addDaysIso(base, item.shelfLifeDays)
        : ''
    return {
      key: `${item.rawName}-${index}`,
      included: true,
      name: item.name,
      quantity:
        item.suggestedQuantity != null
          ? String(item.suggestedQuantity)
          : item.quantity != null
            ? String(item.quantity)
            : '1',
      unit: item.suggestedUnit ?? item.unit ?? 'package',
      kind,
      locationId: pickLocationId(locations, kind),
      expiresOn,
      productId: item.suggestedProduct?.id ?? null,
      matchName: item.suggestedProduct?.name ?? null,
      confidence: item.confidence,
      lineTotal: item.lineTotal,
      status: 'idle',
      error: null,
    }
  })
}

export function ReceiptReview({
  draft,
  locations,
  products,
  onClose,
  onDone,
}: {
  draft: ReceiptExtractResponse['receipt']
  locations: LocationRecord[]
  products: ProductRecord[]
  onClose: () => void
  onDone: () => void
}) {
  const [lines, setLines] = useState(() => toReviewLines(draft.items, locations, draft.date))
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const selected = useMemo(() => lines.filter((line) => line.included && line.status !== 'ok'), [lines])

  function updateLine(key: string, patch: Partial<ReviewLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  function setAllIncluded(included: boolean) {
    setLines((current) => current.map((line) => (line.status === 'ok' ? line : { ...line, included })))
  }

  function changeKind(line: ReviewLine, kind: ProductKind) {
    updateLine(line.key, {
      kind,
      // Re-home only lines still on the automatic location for their old kind.
      locationId:
        line.locationId === pickLocationId(locations, line.kind) ? pickLocationId(locations, kind) : line.locationId,
      expiresOn: kind === 'household' ? '' : line.expiresOn,
    })
  }

  async function commitLine(line: ReviewLine): Promise<ReviewLine> {
    try {
      const name = validateProductName(line.name).name
      const quantity = validateQuantity(Number(line.quantity.replace(',', '.')))
      if (!line.locationId) {
        throw new Error('NO_LOCATION')
      }
      let productId = line.productId
      if (!productId) {
        const created = await createProduct({ name, unit: line.unit })
        productId = created.product.id
        if (line.kind === 'household') {
          await setProductKind(productId, 'household').catch(() => undefined)
        }
      }
      await addStock({
        productId,
        locationId: line.locationId,
        quantity,
        expiresOn: line.expiresOn || null,
      })
      return { ...line, productId, name, status: 'ok', error: null }
    } catch (cause) {
      return {
        ...line,
        status: 'error',
        error:
          cause instanceof Error && cause.message === 'NO_LOCATION'
            ? t('Alege o locație.')
            : mapPantryApiError(cause),
      }
    }
  }

  async function commitAll() {
    if (busy) {
      return
    }
    setBusy(true)
    setFormError(null)
    const next = [...lines]
    for (let index = 0; index < next.length; index += 1) {
      const line = next[index]
      if (!line || !line.included || line.status === 'ok') {
        continue
      }
      next[index] = await commitLine(line)
      setLines([...next])
    }
    setBusy(false)
    if (next.filter((line) => line.included).every((line) => line.status === 'ok')) {
      onDone()
      return
    }
    if (next.some((line) => line.included && line.status === 'error')) {
      setFormError(t('Unele produse nu s-au putut adăuga. Corectează și reîncearcă.'))
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('Verifică bonul')}</h1>
      {draft.merchant || draft.date || draft.total != null ? (
        <p className="mt-2 text-sm text-muted">
          {[draft.merchant, draft.date, draft.total != null ? `${draft.total} ${draft.currency ?? ''}`.trim() : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      <p className="mt-2 text-sm text-muted">
        {t('Am găsit {n} produse. Toate sunt bifate; debifează ce nu vrei să adaugi.', { n: lines.length })}
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="flex min-h-touch items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium"
          onClick={() => setAllIncluded(true)}
        >
          <CheckCheck className="size-4" aria-hidden="true" />
          {t('Bifează tot')}
        </button>
        <button
          type="button"
          className="flex min-h-touch items-center rounded-full border border-border px-3 text-sm font-medium"
          onClick={() => setAllIncluded(false)}
        >
          {t('Debifează tot')}
        </button>
      </div>

      <ul className="mt-4 space-y-3">
        {lines.map((line) => {
          const locked = line.status === 'ok' || !line.included
          return (
            <li key={line.key} className="rounded-xl border border-border p-3">
              <label className="flex min-h-touch items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={line.included}
                  disabled={line.status === 'ok'}
                  onChange={(event) => updateLine(line.key, { included: event.target.checked })}
                />
                {line.name}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {line.matchName ? (
                  <span className="pill" data-tone="success">
                    {t('Potrivire:')}{' '}{line.matchName}
                  </span>
                ) : (
                  <span className="pill">{t('Produs nou')}</span>
                )}
                {line.kind === 'household' ? (
                  <span className="pill" data-tone="success">
                    {t('Produs de casă')}
                  </span>
                ) : null}
                {line.confidence != null && line.confidence < 0.5 ? (
                  <span className="pill" data-tone="warning">
                    {t('Încredere scăzută')}
                  </span>
                ) : null}
              </div>
              <input
                value={line.name}
                disabled={locked}
                aria-label={t('Produs')}
                onChange={(event) =>
                  updateLine(line.key, { name: event.target.value, productId: null, matchName: null })
                }
                className={fieldClassName}
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  inputMode="decimal"
                  value={line.quantity}
                  disabled={locked}
                  aria-label={t('Cantitate')}
                  onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                  className={fieldClassName}
                />
                <select
                  value={line.unit}
                  disabled={locked || line.productId != null}
                  aria-label={t('Unitate')}
                  onChange={(event) => updateLine(line.key, { unit: event.target.value as Unit })}
                  className={fieldClassName}
                >
                  {UNIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-xs text-muted">{t('Unitate:')}{' '}{unitLabel(line.unit)}</p>
              <select
                className={fieldClassName}
                value={line.productId ?? ''}
                disabled={locked}
                aria-label={t('Produs existent')}
                onChange={(event) => {
                  const id = event.target.value || null
                  const match = products.find((product) => product.id === id)
                  updateLine(line.key, {
                    productId: id,
                    matchName: match?.name ?? null,
                    unit: match?.unit ?? line.unit,
                  })
                }}
              >
                <option value="">{t('Produs nou')}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select
                  className={fieldClassName}
                  value={line.locationId}
                  disabled={locked}
                  aria-label={t('Locație')}
                  onChange={(event) => updateLine(line.key, { locationId: event.target.value })}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
                <select
                  className={fieldClassName}
                  value={line.kind}
                  disabled={locked || line.productId != null}
                  aria-label={t('Tip produs')}
                  onChange={(event) => changeKind(line, event.target.value as ProductKind)}
                >
                  <option value="food">{t('Mâncare')}</option>
                  <option value="household">{t('Produs de casă')}</option>
                </select>
              </div>
              <label className="mt-2 block text-xs font-medium text-muted">
                {t('Data expirării (opțional)')}
                <input
                  type="date"
                  value={line.expiresOn}
                  disabled={locked}
                  onChange={(event) => updateLine(line.key, { expiresOn: event.target.value })}
                  className={fieldClassName}
                />
              </label>
              {line.lineTotal != null ? <p className="mt-1 text-xs text-muted">{line.lineTotal}{' '}{t('lei')}</p> : null}
              {line.status === 'ok' ? <p className="mt-1 text-xs text-success">{t('Adăugat')}</p> : null}
              {line.error ? <p className="mt-1 text-xs text-destructive">{t(line.error)}</p> : null}
            </li>
          )
        })}
      </ul>

      <div role="alert" className="mt-3 min-h-5 text-sm text-destructive">
        {formError ? t(formError) : null}
      </div>
      <button
        type="button"
        disabled={busy || selected.length === 0}
        className="mt-3 flex h-touch min-h-touch w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60"
        onClick={() => void commitAll()}
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
        {t('Adaugă {n} în inventar', { n: selected.length })}
      </button>
      <button type="button" className="mt-3 w-full text-sm text-muted" onClick={onClose}>
        {t('Anulează')}
      </button>
    </div>
  )
}
