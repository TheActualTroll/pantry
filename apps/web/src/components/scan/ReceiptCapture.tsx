import { Camera, ImagePlus, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { isPantryApiError } from '../../lib/api'
import { RECEIPT_IMAGE_TOO_LARGE_MESSAGE, prepareReceiptImage } from '../../lib/receipt-image'
import { mergeReceipts } from '../../lib/receipt-merge'
import { RECEIPT_RATE_LIMIT_MESSAGE, mapPantryApiError } from '../../lib/pantry-api-error'
import { extractReceipt, type ReceiptExtractResponse } from '../../lib/pantry-api'
import { t } from '../../i18n/index'

const MAX_PHOTOS = 4

type Photo = { id: string; file: File; url: string }

export function ReceiptCapture({
  onClose,
  onExtracted,
}: {
  onClose: () => void
  onExtracted: (draft: ReceiptExtractResponse['receipt']) => void
}) {
  const cameraInputId = useId()
  const galleryInputId = useId()
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const photosRef = useRef(photos)
  photosRef.current = photos

  useEffect(
    () => () => {
      for (const photo of photosRef.current) {
        URL.revokeObjectURL(photo.url)
      }
    },
    [],
  )

  function addFiles(selected: FileList | null) {
    if (!selected || selected.length === 0) {
      return
    }
    setError(null)
    setPhotos((current) => {
      const room = MAX_PHOTOS - current.length
      const added = [...selected].slice(0, Math.max(0, room)).map((file) => ({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
      }))
      return [...current, ...added]
    })
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === id)
      if (target) {
        URL.revokeObjectURL(target.url)
      }
      return current.filter((photo) => photo.id !== id)
    })
  }

  async function process() {
    if (photos.length === 0 || busy) {
      return
    }
    setBusy(true)
    setError(null)
    setProgress(0)
    try {
      const parts: ReceiptExtractResponse['receipt'][] = []
      for (const photo of photos) {
        const prepared = await prepareReceiptImage(photo.file)
        const result = await extractReceipt(
          prepared.blob,
          `receipt.${prepared.mimeType === 'image/webp' ? 'webp' : 'jpg'}`,
        )
        parts.push(result.receipt)
        setProgress(parts.length)
      }
      onExtracted(mergeReceipts(parts))
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === RECEIPT_IMAGE_TOO_LARGE_MESSAGE
          ? RECEIPT_IMAGE_TOO_LARGE_MESSAGE
          : isPantryApiError(cause) && cause.code === 'AI_RATE_LIMIT'
            ? RECEIPT_RATE_LIMIT_MESSAGE
            : mapPantryApiError(cause),
      )
    } finally {
      setBusy(false)
    }
  }

  const full = photos.length >= MAX_PHOTOS

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Scanează bon')}</h1>
        <button type="button" className="text-sm text-muted" onClick={onClose}>
          {t('Închide')}
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">
        {t('Fă o poză lizibilă sau alege o imagine din telefon. Imaginea nu se salvează.')}
      </p>
      <p className="mt-1 text-sm text-muted">{t('Bon lung? Adaugă mai multe poze, cel mult 4.')}</p>

      <input
        id={cameraInputId}
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          addFiles(event.target.files)
          event.target.value = ''
        }}
      />
      <input
        id={galleryInputId}
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          addFiles(event.target.files)
          event.target.value = ''
        }}
      />

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={full || busy}
          className="flex h-touch min-h-touch items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60"
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="size-4" aria-hidden="true" />
          {photos.length > 0 ? t('Încă o poză') : t('Fă o poză')}
        </button>
        <button
          type="button"
          disabled={full || busy}
          className="flex h-touch min-h-touch items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium disabled:opacity-60"
          onClick={() => galleryRef.current?.click()}
        >
          <ImagePlus className="size-4" aria-hidden="true" />
          {t('Alege din galerie')}
        </button>
      </div>

      {photos.length > 0 ? (
        <div className="mt-5">
          <ul className="grid grid-cols-2 gap-3">
            {photos.map((photo, index) => (
              <li key={photo.id} className="relative">
                <img
                  src={photo.url}
                  alt={t('Previzualizare bon')}
                  className="h-40 w-full rounded-xl bg-surface object-contain"
                />
                <span className="pill absolute bottom-2 left-2">{index + 1}</span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t('Șterge poza')}
                  className="absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-full bg-black/55 text-white"
                  onClick={() => removePhoto(photo.id)}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            className="mt-4 flex h-touch min-h-touch w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60"
            onClick={() => void process()}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            {busy
              ? t('Se citește bonul {current}/{total}...', { current: Math.min(progress + 1, photos.length), total: photos.length })
              : t('Procesează bonul')}
          </button>
        </div>
      ) : null}

      <div role="alert" className="mt-3 min-h-5 text-sm text-destructive">
        {error ? t(error) : null}
      </div>
    </div>
  )
}
