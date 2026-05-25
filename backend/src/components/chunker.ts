import { EmbeddingDocument } from '../types.js';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { RecursiveCharacterTextSplitter } from '@langchain/classic/text_splitter';
import { config } from '../utils/config.js';
import { cleanDescription } from '../utils/helpers.js';

export class Chunker {
  static async chunk(): Promise<EmbeddingDocument[]> {
    console.log('Chunking documents...');
    const startTime = Date.now();
    const documents: EmbeddingDocument[] = [];
    const files = await readdir(config.documentsPath, {
      withFileTypes: true,
      recursive: true,
    });

    // Process files in batches with progress logging
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.isDirectory()) {
        continue;
      }

      const documentPath = path.join(file.parentPath, file.name);
      const content = await readFile(documentPath, 'utf-8');
      const cleanedContent = cleanDescription(content);
      const splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
        chunkSize: config.indexing.chunkSize,
        chunkOverlap: config.indexing.chunkOverlap,
      });
      const chunks = await splitter.splitText(cleanedContent);

      chunks.forEach((chunk, index) => {
        documents.push({
          id: `${file.name}_${index}`,
          pageContent: chunk,
          metadata: {
            path: path.relative(config.documentsPath, documentPath),
            chunkIndex: index,
            totalChunks: chunks.length,
          },
        });
      });
    }

    const totalDuration = Date.now() - startTime;

    console.log(`Chunking completed in ${totalDuration}ms`);

    return documents;
  }
}
