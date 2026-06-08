import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { config } from './config.js';

// Single shared instance — SqliteSaver opens the file itself
let _saver: SqliteSaver | null = null;

export const getSqliteSaver = (): SqliteSaver => {
  if (!_saver) {
    _saver = SqliteSaver.fromConnString(config.database.url);
  }
  return _saver;
};

export const getDb = () => getSqliteSaver().db;
