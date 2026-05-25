import { Chunker } from '../chunker.js';
import { InvertedIndex } from './keyword.js';
import { VectorIndex } from './vector.js';

let invertedIndex: InvertedIndex;
let vectorIndex: VectorIndex;

export const indexing = {
  init: async () => {
    const documents = await Chunker.chunk();
    invertedIndex = new InvertedIndex(documents);
    await invertedIndex.build();

    vectorIndex = new VectorIndex(documents);
    await vectorIndex.build();
  },
  invertedIndex: () => invertedIndex,
  vectorIndex: () => vectorIndex,
};
