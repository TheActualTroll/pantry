import { expect, test } from 'vitest'
import { parseGeminiJsonResponse } from './gemini'

test('parses structured JSON from Gemini candidates', () => {
  expect(
    parseGeminiJsonResponse(
      { candidates: [{ content: { parts: [{ text: '{"merchant":"Lidl","items":[]}' }] } }] },
      'RECEIPT_EXTRACTION_FAILED',
    ),
  ).toMatchObject({ merchant: 'Lidl' })
})

test('rejects Gemini responses without parseable JSON', () => {
  expect(() => parseGeminiJsonResponse({ candidates: [] }, 'RECEIPT_EXTRACTION_FAILED')).toThrow()
  expect(() =>
    parseGeminiJsonResponse({ candidates: [{ content: { parts: [{ text: 'nope' }] } }] }, 'AI_GENERATION_FAILED'),
  ).toThrow()
})
