import { SearchType } from '../types.js';
import { HybridIndex } from './indexing/hybrid.js';
import { indexing } from './indexing/index.js';

const keyword = async (query: string, topK: number = 10) => {
  const invertedIndex = indexing.invertedIndex();

  return invertedIndex.search(query, topK);
};

const semantic = async (query: string, topK: number = 10) => {
  const vectorIndex = indexing.vectorIndex();

  return vectorIndex.search(query, topK);
};

const hybrid = async (query: string, topK: number = 10) => {
  const hybridIndex = new HybridIndex();

  return hybridIndex.search(query, topK);
};

export const search: Record<
  SearchType,
  (query: string, topK?: number) => Promise<any>
> = {
  keyword,
  semantic,
  hybrid,
};
