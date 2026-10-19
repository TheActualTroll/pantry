import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ServerConfig } from './config.js'

/** Daily consistent snapshot (`VACUUM INTO`) kept on the volume; oldest pruned. */
export function startBackups(db: DatabaseSync, config: ServerConfig): () => void {
  if (config.backupKeep <= 0) {
    return () => {}
  }
  mkdirSync(config.backupsDir, { recursive: true, mode: 0o700 })

  function snapshot() {
    const stamp = new Date().toISOString().slice(0, 10)
    const target = join(config.backupsDir, `pantry-${stamp}.db`)
    try {
      rmSync(target, { force: true })
      db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
      const files = readdirSync(config.backupsDir)
        .filter((file) => /^pantry-\d{4}-\d{2}-\d{2}\.db$/.test(file))
        .sort()
      for (const old of files.slice(0, Math.max(0, files.length - config.backupKeep))) {
        rmSync(join(config.backupsDir, old), { force: true })
      }
    } catch {
      console.error(JSON.stringify({ message: 'backup failed' }))
    }
  }

  const first = setTimeout(snapshot, 60_000)
  const timer = setInterval(snapshot, 24 * 60 * 60 * 1000)
  first.unref()
  timer.unref()
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
