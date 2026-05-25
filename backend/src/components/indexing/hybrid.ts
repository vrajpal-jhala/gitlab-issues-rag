import { config } from "../../utils/config.js";
import { indexing } from "./index.js";
import { InvertedIndex } from "./keyword.js";
import { VectorIndex } from "./vector.js";

export class HybridIndex {
  invertedIndex: InvertedIndex;
  vectorIndex: VectorIndex;

  constructor() {
    this.invertedIndex = indexing.invertedIndex();
    this.vectorIndex = indexing.vectorIndex();
  }

  async search(query: string, topK: number) {
    const keywordResults = await this.invertedIndex.search(query, topK * 5);
    const semanticResults = await this.vectorIndex.search(query, topK * 5);
    const hybridResults = new Array(
      Math.max(keywordResults.length, semanticResults.length),
    )
      .fill(0)
      .map((_, index) => {
        let keywordRank = 0;
        let semanticRank = 0;
        let result = null;

        if (keywordResults[index]) {
          keywordRank = index + 1;
          semanticRank = keywordResults[index].id
            ? semanticResults.findIndex(
                (result) => result.id === keywordResults[index].id,
              ) + 1
            : 0;
          result = keywordResults[index];
        } else {
          semanticRank = index + 1;
          keywordRank = semanticResults[index].id
            ? keywordResults.findIndex(
                (result) => result.id === semanticResults[index].id,
              ) + 1
            : 0;
          result = semanticResults[index];
        }

        // reciprocal rank fusion
        return {
          ...result,
          score:
            1 / (config.search.rrfK + keywordRank) +
            1 / (config.search.rrfK + semanticRank),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK * 2); // Return more results to allow for better re-ranking

    return hybridResults;
  }
}
