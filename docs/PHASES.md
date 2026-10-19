# Delivery phases

Status of the work requested for the Railway / modern / bilingual / notifications release.

## 1. Modern look (done)
1. Design tokens: Inter, softer palette, larger radii, glass surfaces, dark mode kept.
2. Shell: sticky glass header with logo, floating bottom navigation, sheet animations.
3. Components: gradient primary buttons, focus rings, status pills, segmented controls, product cards.
4. PWA icons and theme colour regenerated.

## 2. Railway + security (done)
1. Node server (`apps/web/server`) around the existing Hono API; SQLite via `node:sqlite`, filesystem object store for photos, automatic migrations, daily backups.
2. Dockerfile (non-root drop, healthcheck), `railway.json`, `.env.example`, strict env validation.
3. Hardening: CSP + security headers, origin (CSRF) guard, rate limits, body limits, secure cookies, push endpoint allow-list.
4. Tests for config, origin guard and rate limiting; Cloudflare build kept working.

## 3. Romanian / English (done)
1. `t()` i18n core, language persisted locally and on the profile, instant switch.
2. Every screen, error message, date/number format and navigation label translated.
3. Recipes (Gemini) and notifications follow the user's language.
4. Coverage test: a missing English string fails CI.

## 4. Receipt scanning (done)
1. Gemini prompt rewritten for Romanian receipts (every product line, discounts/VAT ignored, abbreviations expanded).
2. Each line gets a food/household category and a shelf-life estimate, turned into a suggested expiry date.
3. Up to 4 photos per receipt are merged; review screen has select all / none, per-line expiry, kind, and location (food → fridge, household → cupboard).
4. "Add N to inventory" creates missing products and stock in one go.

## 5. Notifications (done)
1. Data model (migration 0014): product kind, stock level, subscriptions, preferences, sent-log.
2. Domain logic with tests: none / half / all planning, due checks, digest planning, dedupe.
3. Server: Web Push (VAPID), per-user daily scheduler in the user's time zone, dead-subscription cleanup.
4. Service worker with action buttons that answer the stock check without opening the app; in-app card as fallback (iOS).
5. Settings: enable/disable per device, alert types, lead time, hour, test notification.
