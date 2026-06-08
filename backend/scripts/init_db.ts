import { access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';
import { config } from '../src/utils/config.js';

async function initDB() {
  const vectorDbPath = dirname(new URL(config.vectors.url).pathname);
  try {
    await access(vectorDbPath);
  } catch (err) {
    await mkdir(vectorDbPath, { recursive: true });
  }

  const vectorClient = createClient({ url: config.vectors.url });

  await vectorClient.execute(`
    CREATE TABLE IF NOT EXISTS ${config.vectors.table} (
      id TEXT PRIMARY KEY,
      content TEXT,
      metadata TEXT,
      vector F32_BLOB(${config.embeddings.dimension})
    )
  `);

  await vectorClient.execute(
    `CREATE INDEX IF NOT EXISTS idx_${config.vectors.table}_${config.vectors.column} ON ${config.vectors.table}(libsql_vector_idx(${config.vectors.column}))`,
  );

  const databaseClient = new Database(config.database.url);

  // Create threads table in the same DB
  databaseClient.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  databaseClient.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      start_checkpoint_id TEXT,
      end_checkpoint_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      input TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  console.log('Database initialized');
}

initDB().catch((err) => {
  console.error('Error initializing database:', err);
  process.exit(1);
});
