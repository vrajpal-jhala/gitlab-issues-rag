import type { Run } from '../types';
import { Fragment, type MouseEventHandler } from 'react';
import { Markdown } from './markdown';
import LoadingBubbles from './loading-bubbles';

interface IMessagesProps {
  runs: Run[];
  collapsed: string[];
  onCollapse: MouseEventHandler<HTMLElement>;
  loading: boolean;
}

const Messages = ({ runs, collapsed, onCollapse, loading }: IMessagesProps) => {
  return (
    <div id="messages">
      {runs.map((run) => {
        // Index tool outputs by call ID so each tool_input can render its result inline.
        const toolOutputs = new Map(
          run.events
            .filter((e) => e.event === 'tool_output')
            .map((e) => [e.data.id, e.data.output]),
        );

        return (
          <Fragment key={run.id}>
            {/* User query */}
            <div id="message" data-role="user">
              {run.input.query}
            </div>

            {/* Assistant reply */}
            {run.events.map((event) => {
              const eventId = event.data.id;

              if (event.event === 'message') {
                return (
                  <div key={eventId} id="message" data-role="assistant">
                    {event.data.reasoningContent && (
                      <div id="message-reasoning">
                        <strong
                          id="message-reasoning-title"
                          data-collapsed={collapsed.includes(eventId)}
                          data-id={eventId}
                          onClick={onCollapse}
                        >
                          <span id="message-reasoning-title-icon">&gt;</span>{' '}
                          Thinking
                        </strong>
                        {!collapsed.includes(eventId) && (
                          <div id="message-markdown">
                            <Markdown content={event.data.reasoningContent} />
                          </div>
                        )}
                      </div>
                    )}
                    <Markdown content={event.data.content} />
                  </div>
                );
              }

              {
                /* Tool calls */
              }
              if (event.event === 'tool_output') return null; // tool_output is merged with tool_input - skip here

              if (event.event === 'tool_input') {
                const output = toolOutputs.get(eventId);

                return (
                  <div key={eventId} id="message" data-role="tool">
                    <span
                      id="message-tool"
                      data-collapsed={collapsed.includes(eventId)}
                      data-id={eventId}
                      onClick={onCollapse}
                    >
                      <span id="message-tool-icon">&gt;</span> {event.data.name}
                    </span>
                    {!collapsed.includes(eventId) && (
                      <pre id="message-markdown">
                        {JSON.stringify(event.data.input, null, 2)}
                        {output !== undefined && (
                          <>
                            <hr />
                            {JSON.stringify(JSON.parse(output), null, 2)}
                          </>
                        )}
                      </pre>
                    )}
                  </div>
                );
              }

              return null;
            })}
          </Fragment>
        );
      })}
      {loading && <LoadingBubbles />}
    </div>
  );
};

export default Messages;
