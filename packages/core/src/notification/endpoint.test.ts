import { expect, test } from 'vitest'
import { isAllowedPushEndpoint } from './endpoint.js'

test('accepts the public push services', () => {
  expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
  expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true)
  expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true)
  expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/?token=abc')).toBe(true)
})

test('rejects other hosts, plain http, ports and credentials', () => {
  expect(isAllowedPushEndpoint('http://fcm.googleapis.com/abc')).toBe(false)
  expect(isAllowedPushEndpoint('https://localhost/abc')).toBe(false)
  expect(isAllowedPushEndpoint('https://169.254.169.254/latest')).toBe(false)
  expect(isAllowedPushEndpoint('https://evilfcm.googleapis.com.attacker.example/abc')).toBe(false)
  expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/abc')).toBe(false)
  expect(isAllowedPushEndpoint('https://user:pw@fcm.googleapis.com/abc')).toBe(false)
  expect(isAllowedPushEndpoint('not a url')).toBe(false)
})
