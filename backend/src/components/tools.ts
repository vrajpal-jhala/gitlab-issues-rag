import { z } from 'zod';
import { DynamicStructuredTool, tool } from '@langchain/core/tools';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { indexing } from './indexing/index.js';
import { HybridIndex } from './indexing/hybrid.js';
import { config } from '../utils/config.js';

const schema = z.object({
  type: z
    .enum(['semantic', 'keyword', 'hybrid'])
    .describe(
      'The type of search to perform. "semantic" for vector-based search, "keyword" for inverted index search, and "hybrid" for a combination of both with RRF.',
    ),
  query: z
    .string()
    .describe(
      'The query to search the documents for. Should contain all relevant context. Should ideally be text that might appear in the documents.',
    ),
  topK: z
    .number()
    .optional()
    .default(10)
    .describe('Maximum number of chunks to return. Default: 10.'),
});

const search = tool(
  async (input: z.infer<typeof schema>) => {
    const { type, query, topK = 10 } = input;
    let index =
      type === 'hybrid'
        ? new HybridIndex()
        : indexing[type === 'semantic' ? 'vectorIndex' : 'invertedIndex']();

    return JSON.stringify(await index.search(query, topK));
  },
  {
    name: 'search',
    description: `Search documents using either semantic or keyword-based methods. The "semantic" method uses vector embeddings to find relevant chunks based on meaning, while the "keyword" method uses an inverted index to find chunks containing exact matches of the query terms. The input should specify the type of search and the query string, along with an optional topK parameter to limit the number of results.`,
    schema,
    tags: ['search', 'semantic', 'keyword', 'hybrid'],
  },
);

let filesystemTools: DynamicStructuredTool[] = [];

export const tools = {
  init: async () => {
    // Init MCP client for agent tools
    const filesystemClient = new MultiServerMCPClient({
      useStandardContentBlocks: true,
      mcpServers: {
        filesystem: {
          transport: 'stdio',
          command: 'npx',
          args: [
            '-y',
            '@modelcontextprotocol/server-filesystem',
            config.documentsPath,
          ],
        },
      },
    });

    filesystemTools = await filesystemClient.getTools();
  },
  getAll: () => [search, ...filesystemTools],
};
