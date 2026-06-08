import { indexing } from '../components/indexing/index.js';
import { crossEncoder } from '../components/rerank.js';
import { tools } from '../components/tools.js';
import { workflow } from '../components/workflow.js';

export const services = {
  init: async () => {
    // Start indexing
    await indexing.init();

    // Init cross-encoder model once
    await crossEncoder.init();

    // Init tools (e.g., from mcp servers)
    await tools.init();

    // Init workflows
    await workflow.init();
  },
};
