import { MessageType, type Message } from '../types';
import { Markdown } from './markdown';

interface IMessagesProps {
  messages: Message[];
  collapsed: Message['id'][];
  setCollapsed: React.Dispatch<React.SetStateAction<Message['id'][]>>;
  isLoading: boolean;
}

const Messages = ({
  messages,
  collapsed,
  setCollapsed,
  isLoading,
}: IMessagesProps) => {
  return (
    <div id="messages">
      {messages.map((message) => (
        <div key={message.id} id="message" data-role={message.type}>
          {message.type === MessageType.USER ? (
            message.content
          ) : message.type === MessageType.ASSISTANT ? (
            <>
              <div id="message-reasoning">
                {message.reasoningContent && (
                  <>
                    <strong
                      id="message-reasoning-title"
                      data-collapsed={collapsed.includes(message.id)}
                      onClick={() => {
                        setCollapsed((prev) =>
                          prev.includes(message.id)
                            ? prev.filter((id) => id !== message.id)
                            : [...prev, message.id],
                        );
                      }}
                    >
                      <span id="message-reasoning-title-icon">&gt;</span>{' '}
                      Thinking
                    </strong>
                    {!collapsed.includes(message.id) && (
                      <div id="message-markdown">
                        <Markdown content={message.reasoningContent} />
                      </div>
                    )}
                  </>
                )}
              </div>
              <Markdown content={message.content} />
            </>
          ) : message.type === MessageType.TOOL ? (
            <>
              <span
                id="message-tool"
                data-collapsed={collapsed.includes(message.id)}
                onClick={() => {
                  setCollapsed((prev) =>
                    prev.includes(message.id)
                      ? prev.filter((id) => id !== message.id)
                      : [...prev, message.id],
                  );
                }}
              >
                <span id="message-tool-icon">&gt;</span> {message.name}
              </span>
              {!collapsed.includes(message.id) && (
                <pre id="message-markdown">
                  {JSON.stringify(message.input, null, 2)}
                  <hr />
                  {JSON.stringify(
                    JSON.parse(message.output as string),
                    null,
                    2,
                  )}
                </pre>
              )}
            </>
          ) : (
            'Unknown message type'
          )}
        </div>
      ))}
      {isLoading && (
        <div id="loading-bubbles">
          <div className="loading-bubble circle1" />
          <div className="loading-bubble circle2" />
          <div className="loading-bubble circle3" />
        </div>
      )}
    </div>
  );
};

export default Messages;
