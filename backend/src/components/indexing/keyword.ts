import path from 'node:path';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { EmbeddingDocument, DocumentSearchResult } from '../../types.js';
import { config } from '../../utils/config.js';
import { tokenizeText, sanitizeText } from '../../utils/helpers.js';

class Counter {
  map: Map<string, number>;

  constructor() {
    this.map = new Map<string, number>();
  }

  update(tokens: string[]) {
    for (const token of tokens) {
      this.map.set(token, (this.map.get(token) || 0) + 1);
    }
  }

  get(token: string) {
    return this.map.get(token) || 0;
  }

  toJSON() {
    return Object.fromEntries(this.map);
  }

  static fromJSON(json: Record<string, number>) {
    const counter = new Counter();

    for (const [token, count] of Object.entries(json)) {
      counter.map.set(token, count);
    }

    return counter;
  }
}

export class InvertedIndex {
  static basePath = path.resolve(config.indexing.path, 'inverted');
  static indexPath = path.resolve(InvertedIndex.basePath, 'index.json');
  static termFrequencyPath = path.resolve(
    InvertedIndex.basePath,
    'term_frequency.json',
  );
  static documentLengthPath = path.resolve(
    InvertedIndex.basePath,
    'document_length.json',
  );
  static docMapPath = path.resolve(InvertedIndex.basePath, 'doc_map.json');

  documents: EmbeddingDocument[];
  docMap: Record<EmbeddingDocument['id'], EmbeddingDocument>;
  index: Record<string, EmbeddingDocument['id'][]>;
  termFrequency: Record<EmbeddingDocument['id'], Counter>;
  documentLength: Record<EmbeddingDocument['id'], number>;

  constructor(documents: EmbeddingDocument[] = []) {
    this.documents = documents;
    this.docMap = {};
    this.index = {};
    this.termFrequency = {} as Record<EmbeddingDocument['id'], Counter>;
    this.documentLength = {};
  }

  private _addDocument(docId: EmbeddingDocument['id'], text: string) {
    const tokens = tokenizeText(sanitizeText(text));

    for (const token of new Set(tokens)) {
      if (!Array.isArray(this.index[token])) {
        this.index[token] = [];
      }

      this.index[token].push(docId);
    }

    if (!this.termFrequency[docId]) {
      this.termFrequency[docId] = new Counter();
    }

    this.termFrequency[docId].update(Array.from(tokens));
    this.documentLength[docId] = tokens.length;
  }

  private _getAverageDocumentLength() {
    const lengths = Object.values(this.documentLength);

    if (lengths.length === 0) {
      return 0;
    }

    return lengths.reduce((acc, length) => acc + length, 0) / lengths.length;
  }

  getDocuments(term: string) {
    return (this.index[term] || []).sort((a, b) => (a > b ? 1 : -1));
  }

  getBM25InverseDocumentFrequency(term: string) {
    const token = tokenizeText(term)[0];
    if (!token) {
      throw new Error('Can only have 1 token');
    }

    const totalDocuments = Object.keys(this.docMap).length;
    const documentFrequency = this.index[token]?.length ?? 0;

    // +0.5 to avoid division by zero
    return Math.log(
      (totalDocuments - documentFrequency + 0.5) / (documentFrequency + 0.5) +
        1, // +1 to prevent negative scores
    ).toFixed(2);
  }

  getBM25TermFrequency(
    docId: EmbeddingDocument['id'],
    term: string,
    k1: number = config.indexing.bm25_k1,
    b: number = config.indexing.bm25_b,
  ) {
    const token = tokenizeText(term)[0];
    if (!token) {
      throw new Error('Can only have 1 token');
    }

    const tf = this.termFrequency[docId]?.get(token) ?? 0;
    const averageDocumentLength = this._getAverageDocumentLength();
    const lengthNormalization =
      averageDocumentLength > 0
        ? 1 -
          b +
          b * ((this.documentLength[docId] ?? 0) / averageDocumentLength)
        : 1;

    return (tf * (k1 + 1)) / (tf + k1 * lengthNormalization);
  }

  getBM25TfIdf(
    docId: EmbeddingDocument['id'],
    term: string,
    k1: number = config.indexing.bm25_k1,
    b: number = config.indexing.bm25_b,
  ) {
    const tf = this.getBM25TermFrequency(docId, term, k1, b);
    const idf = this.getBM25InverseDocumentFrequency(term);
    return tf * parseFloat(idf);
  }

  async build() {
    // // delete existing index if it exists
    // rm(InvertedIndex.basePath, { recursive: true, force: true });

    try {
      await access(InvertedIndex.indexPath);
      await this.load();
      console.log('Skipping keyword indexing as it is already exists');
      return;
    } catch (err) {
      mkdir(InvertedIndex.basePath, { recursive: true });
    }

    console.log('Building keyword indices...');
    const startTime = Date.now();
    for (const [index, document] of this.documents.entries()) {
      this._addDocument(document.id, document.pageContent);
      this.docMap[document.id] = document;

      process.stdout.write(`${Math.floor((index / this.documents.length) * 100)}%`);
      process.stdout.write('\r');

      if (index === this.documents.length - 1) {
        const duration = Date.now() - startTime;
        console.log(`100%\nKeyword indices built in ${duration}ms!`);
      }
    }

    await this.save();
  }

  private async save() {
    await writeFile(
      InvertedIndex.docMapPath,
      JSON.stringify(this.docMap, null, 2),
    );
    await writeFile(
      InvertedIndex.indexPath,
      JSON.stringify(this.index, null, 2),
    );
    await writeFile(
      InvertedIndex.termFrequencyPath,
      JSON.stringify(this.termFrequency, null, 2),
    );
    await writeFile(
      InvertedIndex.documentLengthPath,
      JSON.stringify(this.documentLength, null, 2),
    );
  }

  private async load() {
    this.docMap = JSON.parse(await readFile(InvertedIndex.docMapPath, 'utf-8'));
    this.index = JSON.parse(await readFile(InvertedIndex.indexPath, 'utf-8'));
    const termFrequency = JSON.parse(
      await readFile(InvertedIndex.termFrequencyPath, 'utf-8'),
    ) as Record<EmbeddingDocument['id'], Record<string, number>>;
    this.termFrequency = Object.entries(termFrequency).reduce(
      (acc, [id, map]) => {
        acc[id] = Counter.fromJSON(map);
        return acc;
      },
      {} as Record<EmbeddingDocument['id'], Counter>,
    );
    this.documentLength = JSON.parse(
      await readFile(InvertedIndex.documentLengthPath, 'utf-8'),
    ) as Record<EmbeddingDocument['id'], number>;
  }

  async search(query: string, topK: number) {
    const results: DocumentSearchResult[] = [];
    const scores: Record<EmbeddingDocument['id'], number> = {};
    const sanitizedQueryTokens = tokenizeText(sanitizeText(query));

    // Only get documents that contain at least one query term
    const candidateDocIds = new Set<string>();
    for (const token of sanitizedQueryTokens) {
      const docIds = this.getDocuments(token);
      docIds.forEach((id) => candidateDocIds.add(id));
    }

    // Score only candidate documents
    for (const docId of candidateDocIds) {
      let score = 0;

      for (const token of sanitizedQueryTokens) {
        score += this.getBM25TfIdf(docId, token);
      }

      scores[docId] = score;
    }

    const sortedScores = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    for (const [docId, score] of sortedScores) {
      results.push({
        ...this.docMap[docId]!,
        score: parseFloat(score.toFixed(2)),
      });
    }

    return results;
  }
}
