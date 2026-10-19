import { DomainError } from '@pantry/core'

export type GeminiFailureCode = 'AI_GENERATION_FAILED' | 'RECEIPT_EXTRACTION_FAILED'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const GEMINI_MODEL_FALLBACKS = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
]

export type GeminiJsonRequest = {
  systemInstruction: string
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>
  schema: Record<string, unknown>
  maxOutputTokens: number
}

function buildGenerationConfig(maxTokens: number) {
  return {
    responseMimeType: 'application/json',
    maxOutputTokens: maxTokens,
    thinkingConfig: { thinkingBudget: 0 },
  }
}

function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds)
  }
  return undefined
}

async function googleFailureToDomainError(response: Response, model: string): Promise<DomainError> {
  const rawBody = await response.text().catch(() => '')
  let message = `Gemini request failed for ${model}`
  let reason = ''

  try {
    const body = JSON.parse(rawBody) as Record<string, unknown>
    const errorBody = body?.error as Record<string, unknown> | undefined
    const errorMessage = typeof errorBody?.message === 'string' ? errorBody.message : undefined
    const errorStatus = typeof errorBody?.status === 'string' ? errorBody.status : undefined
    if (errorMessage) {
      message = errorMessage
    }
    if (errorStatus) {
      reason = errorStatus
    }
  } catch {
    // Keep the fallback message above.
  }

  if (response.status === 429) {
    return new DomainError('AI_RATE_LIMIT', 'AI_RATE_LIMIT', {
      retryAfter: parseRetryAfter(response) ?? 60,
    })
  }

  if (response.status === 404 || /not found|model.*not.*found|unsupported.*model/i.test(message + reason)) {
    return new DomainError('AI_UNAVAILABLE', 'AI_UNAVAILABLE')
  }

  console.error('[gemini] upstream failure', {
    model,
    status: response.status,
    reason,
    message,
    responseBody: rawBody.slice(0, 2000),
  })
  return new DomainError('AI_UNAVAILABLE', 'AI_UNAVAILABLE')
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
  const modelCandidates = Array.from(new Set([model, ...GEMINI_MODEL_FALLBACKS]))

  let lastHttpError: Response | null = null
  let lastDomainError: DomainError | null = null

  for (const candidate of modelCandidates) {
    let response: Response
    try {
      response = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(candidate)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.systemInstruction }] },
          contents: [{ role: 'user', parts: request.parts }],
          generationConfig: buildGenerationConfig(request.maxOutputTokens),
        }),
      })
    } catch (error) {
      console.warn('[gemini] fetch exception', { model: candidate, error })
      continue
    }

    lastHttpError = response

    if (!response.ok) {
      const failure = await googleFailureToDomainError(response, candidate)
      lastDomainError = failure

      if (response.status === 404) {
        continue
      }

      if (response.status === 429) {
        continue
      }

      continue
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new DomainError(failureCode, failureCode)
    }

    try {
      return parseGeminiJsonResponse(payload, failureCode)
    } catch (error) {
      if (error instanceof DomainError && error.code === failureCode) {
        throw error
      }
      throw new DomainError(failureCode, failureCode)
    }
  }

  if (lastDomainError) {
    throw lastDomainError
  }

  if (lastHttpError) {
    console.error('[gemini] model request failed', {
      model,
      status: lastHttpError.status,
      body: await lastHttpError.text().catch(() => ''),
    })
  }
  throw new DomainError('AI_UNAVAILABLE', 'AI_UNAVAILABLE')
}
