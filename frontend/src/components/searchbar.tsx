import { use, useEffect, useState } from 'react';
import { treaty } from '@elysiajs/eden';
import { SearchStrategy, type LLM, type Message } from '../types';
import type { App as ServerApp } from '../../../backend/src';
import { Context } from '../Context';

const app = treaty<ServerApp>(location.href);

interface ISearchbarProps {
  loading: boolean;
  messages: Message[];
  onSearch: (
    query: string,
    strategy: SearchStrategy,
    model: LLM['model'],
    reasoning: boolean,
  ) => void;
  onStop: () => void;
}

const Searchbar = (props: ISearchbarProps) => {
  const { loading, messages, onSearch, onStop } = props;
  const { handleError } = use(Context);

  const [models, setModels] = useState<LLM[]>([]);
  const [query, setQuery] = useState('');
  const [searchStrategy, setSearchStrategy] = useState<SearchStrategy>(
    SearchStrategy.AGENTIC,
  );
  const [model, setModel] = useState<LLM['model']>('');
  const [reasoning, setReasoning] = useState(true);

  useEffect(() => {
    app.api.models.get().then(({ data, error }) => {
      if (error) {
        handleError((error.value.message) || 'Failed to fetch models');
        return;
      }

      setModels(data);
      setModel(data.find((m) => m.isDefault)?.model || data[0]?.model || '');
    });
  }, [handleError]);

  const handleSearch = () => {
    setQuery('');
    onSearch(query, searchStrategy, model, reasoning);
  };

  const handleSearchbarKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (e.ctrlKey && e.key === 'Enter') {
      handleSearch();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <>
      {!messages.length && <div id="search-suggestions">
        {[
          'task assigned to Ronit',
          'shared files bugs',
          'tooltip bug',
        ].map((suggestion) => (
          <button
            key={suggestion}
            id="search-suggestion"
            onClick={() =>
              onSearch(suggestion, searchStrategy, model, reasoning)
            }
          >
            <span>🔍</span>
            <span>{suggestion}</span>
          </button>
        ))}
      </div>}
      <div id="searchbar">
        <textarea
          placeholder="Search the GitLab issues..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchbarKeyDown}
          autoFocus
        />
        <div id="searchbar-actions">
          <div id="searchbar-actions-secondary">
            <select
              value={searchStrategy}
              onChange={(e) =>
                setSearchStrategy(e.target.value as SearchStrategy)
              }
            >
              {Object.values(SearchStrategy).map((strategy) => (
                <option key={strategy} value={strategy}>
                  {`${strategy.charAt(0).toUpperCase()}${strategy.slice(1)}`}
                </option>
              ))}
            </select>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as LLM['model'])}
              disabled={!models.length}
            >
              {models.length ? (
                models.map((model) => (
                  <option key={model.model} value={model.model}>
                    {model.name}
                  </option>
                ))
              ) : (
                <option value="">No models available</option>
              )}
            </select>
            <label id="reasoning-toggle">
              <input
                type="checkbox"
                checked={reasoning}
                onChange={(e) => setReasoning(e.target.checked)}
              />
              <span>Reasoning</span>
            </label>
          </div>
          <div id="searchbar-actions-primary" title="Ctrl + Enter">
            {loading ? (
              <button className="stop" onClick={onStop}>
                &#9632;
              </button>
            ) : (
              <button
                className="primary"
                onClick={() => handleSearch()}
                disabled={!query || loading}
              >
                &gt;
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Searchbar;
