import { EmbeddingDocument, DocumentSearchResult } from '../../types.js';
import { LibSQLVectorStore } from '@langchain/community/vectorstores/libsql';
import { OllamaEmbeddings } from '@langchain/ollama';
import { Client, createClient } from '@libsql/client';
import { config } from '../../utils/config.js';

export class VectorIndex {
  documents: EmbeddingDocument[];
  dbClient: Client;
  vectorStore: LibSQLVectorStore;

  constructor(documents: EmbeddingDocument[] = []) {
    this.documents = documents;
    const embeddings = new OllamaEmbeddings({
      baseUrl: config.embeddings.baseUrl,
      model: config.embeddings.model,
    });
    this.dbClient = createClient({ url: config.vectors.url });
    this.vectorStore = new LibSQLVectorStore(embeddings, {
      db: this.dbClient,
      table: config.vectors.table,
      column: config.vectors.column,
    });
  }

  async build() {
    // // Delete all embeddings
    // await this.vectorStore.delete({ deleteAll: true });

    const {
      rows: [{ count }],
    } = await this.dbClient.execute(
      `SELECT COUNT(*) AS count FROM ${config.vectors.table}`,
    );

    if (count && parseInt(count as string) > 0) {
      console.log('Skipping vector indexing as it already exists');
      return;
    }

    console.log('Building vector index...');
    // Drop the vector index before bulk insert — libsql's DiskANN index cannot
    // handle incremental inserts and must be rebuilt after data is loaded.
    await this.dbClient.execute(
      `DROP INDEX IF EXISTS idx_${config.vectors.table}_${config.vectors.column}`,
    );

    const documents = this.documents;
    const startTime = Date.now();
    const BATCH_SIZE = config.embeddings.batchSize;
    const totalBatches = Math.ceil(documents.length / BATCH_SIZE);

    // Process documents in batches with progress logging
    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batchDocuments = documents.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const progress = Math.round((i / documents.length) * 100);

      console.log(
        `Batch ${batchNumber}/${totalBatches}: Processing ${batchDocuments.length} documents (${progress}% complete)`,
      );

      const batchStartTime = Date.now();

      await this.vectorStore.addDocuments(batchDocuments);

      const batchDuration = Date.now() - batchStartTime;
      console.log(`Batch ${batchNumber} completed in ${batchDuration}ms`);
    }

    const totalDuration = Date.now() - startTime;

    // Recreate the vector index now that all data is loaded.
    await this.dbClient.execute(
      `CREATE INDEX idx_${config.vectors.table}_${config.vectors.column} ON ${config.vectors.table}(libsql_vector_idx(${config.vectors.column}))`,
    );

    console.log(`Vector index built in ${totalDuration}ms!`);
    console.log(`Indexing completed: ${documents.length} documents indexed!`);
  }

  async search(query: string, topK: number): Promise<DocumentSearchResult[]> {
    const results = (await this.vectorStore.similaritySearchWithScore(
      query,
      topK,
    )) as Array<[EmbeddingDocument, number]>;

    return results.reverse().map(([doc, score]) => ({
      ...doc,
      score,
    }));
  }
}
