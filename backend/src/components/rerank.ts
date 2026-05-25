import {
  AutoTokenizer,
  AutoModelForSequenceClassification,
} from '@huggingface/transformers';
import { DocumentSearchResult } from '../types.js';
import { config } from '../utils/config.js';

class CrossEncoder {
  static model = config.rerank.model;
  private _model: any = null;
  private _tokenizer: any = null;

  async load() {
    this._tokenizer = await AutoTokenizer.from_pretrained(CrossEncoder.model);
    this._model = await AutoModelForSequenceClassification.from_pretrained(
      CrossEncoder.model,
    );
  }

  async reRank(
    results: DocumentSearchResult[],
    query: string,
  ): Promise<DocumentSearchResult[]> {
    if (!this._model || !this._tokenizer) {
      throw new Error('Cross encoder not loaded');
    }

    const reRankedResults: DocumentSearchResult[] = [];

    for (const result of results) {
      // Tokenize query and text as a pair
      const inputs = await this._tokenizer(query, {
        text_pair: result.pageContent,
        padding: true,
        truncation: true,
      });

      const output = await this._model(inputs);

      // Use raw logit as the relevance score (can be positive or negative)
      // Higher scores = more relevant
      const score = output.logits.data[0];

      reRankedResults.push({ ...result, score });
    }

    return reRankedResults
      .sort((a, b) => b.score - a.score)
      .slice(0, results.length);
  }
}

let crossEncoderInstance: CrossEncoder | null = null;

export const crossEncoder = {
  init: async () => {
    crossEncoderInstance = new CrossEncoder();
    await crossEncoderInstance.load();
  },
  instance: () => {
    if (!crossEncoderInstance) {
      throw new Error('Cross encoder not initialized');
    }
    return crossEncoderInstance;
  },
};
