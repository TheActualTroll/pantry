import { DomainError } from '@pantry/core'

export type GeminiFailureCode = 'AI_GENERATION_FAILED' | 'RECEIPT_EXTRACTION_FAILED'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

export type GeminiJsonRequest = {
  systemInstruction: string
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>
  schema: Record<string, unknown>
  maxOutputTokens: number
}

export function parseGeminiJsonResponse(result: unknown, failureCode: GeminiFailureCode): unknown {
  const candidates = (result as { candidates?: unknown } | null)?.candidates
  if (Array.isArray(candidates) && candidates[0] && typeof candidates[0] === 'object') {
    const content = (candidates[0] as { content?: { parts?: Array<{ text?: unknown }> } }).content
    const text = content?.parts
      ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
    if (text) {
      try {
        return JSON.parse(text) as unknown
      } catch {
        // fall through
      }
    }
  }
  throw new DomainError(failureCode, failureCode)
}

export async function generateGeminiJson(
  apiKey: string,
  model: string,
  request: GeminiJsonRequest,
  failureCode: GeminiFailureCode,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemInstruction }] },
        contents: [{ role: 'user', parts: request.parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: request.schema,
          maxOutputTokens: request.maxOutputTokens,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    })
  } catch {
    throw new DomainError('AI_UNAVAILABLE', 'AI_UNAVAILABLE')
  }

  if (!response.ok) {
    throw new DomainError('AI_UNAVAILABLE', 'AI_UNAVAILABLE')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new DomainError(failureCode, failureCode)
  }
  return parseGeminiJsonResponse(payload, failureCode)
}
