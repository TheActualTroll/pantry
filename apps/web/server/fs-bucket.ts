import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** Keys are app-generated (`households/<id>/products/<id>/<uuid>.ext`); still refuse traversal. */
function resolveKey(root: string, key: string): string {
  if (!/^[A-Za-z0-9_\-./]+$/.test(key) || key.split('/').some((part) => part === '' || part === '..' || part === '.')) {
    throw new Error('Invalid object key')
  }
  const full = resolve(join(root, key))
  if (!full.startsWith(resolve(root) + sep)) {
    throw new Error('Invalid object key')
  }
  return full
}

/** Minimal filesystem stand-in for the R2 calls Pantry makes (get / put / delete). */
export function createFsBucket(root: string): R2Bucket {
  mkdirSync(root, { recursive: true })
  const bucket = {
    async put(key: string, value: unknown) {
      const bytes =
        value instanceof Uint8Array
          ? value
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : typeof value === 'string'
              ? new TextEncoder().encode(value)
              : new Uint8Array(await new Response(value as BodyInit).arrayBuffer())
      const path = resolveKey(root, key)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, bytes, { mode: 0o600 })
      return { key, size: bytes.byteLength }
    },
    async get(key: string) {
      const path = resolveKey(root, key)
      if (!existsSync(path)) {
        return null
      }
      const bytes = new Uint8Array(readFileSync(path))
      const ext = key.split('.').pop()?.toLowerCase() ?? ''
      return {
        body: bytes,
        httpMetadata: { contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream' },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        rmSync(resolveKey(root, key), { force: true })
      }
    },
  }
  return bucket as unknown as R2Bucket
}
