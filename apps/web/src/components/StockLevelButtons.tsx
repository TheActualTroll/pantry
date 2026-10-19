import { t } from '../i18n/index'
import type { StockLevel } from '../lib/pantry-api'

const LEVELS: Array<{ level: StockLevel; label: string }> = [
  { level: 'none', label: 'Nimic' },
  { level: 'half', label: 'Jumătate' },
  { level: 'full', label: 'Tot' },
]

/** None / half / all answer for a household item. */
export function StockLevelButtons({
  current,
  disabled = false,
  onPick,
}: {
  current: StockLevel | null
  disabled?: boolean
  onPick: (level: StockLevel) => void
}) {
  return (
    <div role="group" aria-label={t('Cât a mai rămas?')} className="segmented w-full">
      {LEVELS.map(({ level, label }) => (
        <button
          key={level}
          type="button"
          disabled={disabled}
          aria-pressed={current === level}
          data-active={current === level}
          className="flex-1 disabled:opacity-60"
          onClick={() => onPick(level)}
        >
          {t(label)}
        </button>
      ))}
    </div>
  )
}
