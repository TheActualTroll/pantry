import { t } from '../i18n/index'
export function canUseWebShare(
  share: unknown = typeof navigator === 'undefined' ? undefined : navigator.share,
): boolean {
  return typeof share === 'function'
}

export function invitePath(token: string): string {
  return `/invite/${token}`
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin}${invitePath(token)}`
}

export function inviteSharePayload(householdName: string, url: string) {
  return {
    title: t('Invitație Pantry'),
    text: t('Te invit în {name} pe Pantry.', { name: householdName }),
    url,
  }
}
