import { createClient } from '@libsql/client';
import { config } from '../src/utils/config.js';
import { access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

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

  console.log('Database initialized');
}

initDB().catch((err) => {
  console.error('Error initializing database:', err);
  process.exit(1);
});
