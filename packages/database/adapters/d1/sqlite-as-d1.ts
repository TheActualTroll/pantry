import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { D1DatabaseLike, D1PreparedStatementLike } from './d1-like.js'

const writeQueues = new WeakMap<object, Promise<void>>()

function enqueueWrite<T>(db: object, work: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(db) ?? Promise.resolve()
  const current = previous.then(work, work)
  writeQueues.set(
    db,
    current.then(
      () => undefined,
      () => undefined,
    ),
  )
  return current
}

export function migrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../migrations')
}

export function applyPantryMigrations(db: DatabaseSync): void {
  runMigrations(db)
}

export function sqliteAsD1(db: DatabaseSync): D1DatabaseLike {
  return {
    prepare(query: string): D1PreparedStatementLike {
      let params: SQLInputValue[] = []
      const runNow = () => {
        db.prepare(query).run(...params)
        return { success: true }
      }
      const statement: D1PreparedStatementLike & { runSync(): { success: boolean } } = {
        bind(...values: unknown[]) {
          params = values as SQLInputValue[]
          return statement
        },
        async first<T = unknown>() {
          const row = db.prepare(query).get(...params)
          return (row ?? null) as T | null
        },
        async run() {
          return runNow()
        },
        runSync() {
          return runNow()
        },
        async all<T = unknown>() {
          return { results: db.prepare(query).all(...params) as T[] }
        },
      }
      return statement
    },
    async batch(statements) {
      return enqueueWrite(db, async () => {
        // Run every statement synchronously so no other request can interleave
        // inside the transaction on this single shared connection.
        db.exec('BEGIN IMMEDIATE')
        try {
          const results = []
          for (const statement of statements) {
            const sync = (statement as { runSync?: () => { success: boolean } }).runSync
            results.push(sync ? sync.call(statement) : await statement.run())
          }
          db.exec('COMMIT')
          return results
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      })
    },
  }
}

export function insertUser(db: DatabaseSync, id: string, name: string, email: string): void {
  db.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, datetime('now'), datetime('now'))`,
  ).run(id, name, email)
}

export function insertProfile(db: DatabaseSync, id: string, displayName: string): void {
  db.prepare(
    `INSERT INTO profiles (id, display_name, locale, created_at, updated_at)
     VALUES (?, ?, 'ro', datetime('now'), datetime('now'))`,
  ).run(id, displayName)
}

/**
 * Applies every `NNNN_*.sql` file in `dir` that has not been recorded yet, in
 * name order. Each file runs in its own transaction.
 */
export function runMigrations(db: DatabaseSync, dir: string = migrationsDir()): string[] {
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(
    `CREATE TABLE IF NOT EXISTS _pantry_migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  )
  const applied = new Set(
    (db.prepare('SELECT name FROM _pantry_migrations').all() as Array<{ name: string }>).map((row) => row.name),
  )
  const files = readdirSync(dir)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort()
  const ran: string[] = []
  for (const file of files) {
    if (applied.has(file)) {
      continue
    }
    db.exec('BEGIN')
    try {
      db.exec(readFileSync(join(dir, file), 'utf8'))
      db.prepare("INSERT INTO _pantry_migrations (name, applied_at) VALUES (?, datetime('now'))").run(file)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    ran.push(file)
  }
  return ran
}
