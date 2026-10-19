import { Link } from 'react-router'
import { t } from '../i18n/index'

export function NotFoundPage() {
  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">{t('Not found')}</h1>
      <p className="mt-2 text-muted">{t('This page does not exist.')}</p>
      <p className="mt-4">
        <Link to="/" className="text-accent">
          {t('Go home')}
        </Link>
      </p>
    </section>
  )
}
