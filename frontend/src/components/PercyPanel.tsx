import {
  Bookmark, Check, Lightbulb, MessageCircle, Send, Sparkles, Trash2, User as UserIcon, X,
} from 'lucide-react'
import { formatDate } from '../lib/day'
import { useJournal } from '../state/journalContext'
import { Card, EmptyNote } from './ui/Card'
import { Sheet } from './ui/Sheet'

const SUGGESTIONS = [
  'Tell me about myself based on my journal entries',
  'What recurring patterns or habits do you notice in me?',
  'What helps me feel most productive and satisfied?',
  'How are my goals aligning with my daily reflections?',
]

export function PercyPanel() {
  const {
    panel, closePanel, lifeInsights, dismissInsight, askPercyAboutInsight, chatMessages, chatInput,
    setChatInput, chatLoading, sendPercyMessage, savingAdviceIndex, savePercyAdvice, isAdviceSaved,
    savedPercyAdvice, deletingAdviceId, removeSavedAdvice, activeChatInsight, setActiveChatInsight,
    percyChatRef, percyInputRef,
  } = useJournal()

  return (
    <Sheet
      open={panel === 'percy'}
      onClose={closePanel}
      size="wide"
      eyebrow={<><Sparkles /> Percy</>}
      title="Insights & chat"
      subtitle="Patterns Percy has noticed, and a place to ask about them."
    >
      <Card title="What Percy has noticed" icon={<Lightbulb />} count={lifeInsights.length}>
        {lifeInsights.length ? (
          <ul className="insight-list">
            {lifeInsights.map((insight) => (
              <li className={insight.is_read ? 'insight' : 'insight unread'} key={insight.id}>
                <div>
                  <p>{insight.insight_text}</p>
                  <span className="card-eyebrow">{formatDate(insight.created_at.slice(0, 10))}</span>
                </div>
                <div className="insight-actions">
                  <button className="text-button" onClick={() => askPercyAboutInsight(insight)}>
                    <MessageCircle /> Ask Percy
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => dismissInsight(insight.id)}
                    aria-label="I've seen this, stop showing it"
                    title="I've seen this"
                  >
                    <Check />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote>As you keep journaling, patterns worth noticing will show up here.</EmptyNote>
        )}
      </Card>

      <Card title="Chat with Percy" icon={<Sparkles />}>
        <div className="percy-chat" ref={percyChatRef}>
          {activeChatInsight && (
            <div className="percy-focus">
              <span>Focusing on: “{activeChatInsight.text}”</span>
              <button className="icon-button" onClick={() => setActiveChatInsight(null)} title="Clear focus">
                <X />
              </button>
            </div>
          )}

          {chatMessages.length === 0 ? (
            <div className="chips">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} onClick={() => void sendPercyMessage(suggestion)}>
                  <span>{suggestion}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="percy-messages">
              {chatMessages.map((message, index) => (
                <div key={index} className={`percy-message ${message.role}`}>
                  <div className="percy-message-head">
                    <span>{message.role === 'assistant' ? <Sparkles /> : <UserIcon />}
                      {message.role === 'assistant' ? 'Percy' : 'You'}</span>
                    {message.role === 'assistant' && (
                      <button
                        className={isAdviceSaved(message.content) ? 'text-button saved' : 'text-button'}
                        disabled={isAdviceSaved(message.content) || savingAdviceIndex === index}
                        onClick={() => void savePercyAdvice(index)}
                        title={isAdviceSaved(message.content) ? 'Saved' : 'Save this advice'}
                      >
                        {savingAdviceIndex === index
                          ? <span className="button-spinner" />
                          : <Bookmark fill={isAdviceSaved(message.content) ? 'currentColor' : 'none'} />}
                        {isAdviceSaved(message.content) ? 'Saved' : 'Save'}
                      </button>
                    )}
                  </div>
                  <p>{message.content}</p>
                </div>
              ))}
              {chatLoading && (
                <div className="percy-message assistant">
                  <div className="percy-message-head"><span><Sparkles /> Percy is thinking</span></div>
                  <div className="typing-dots"><span /><span /><span /></div>
                </div>
              )}
            </div>
          )}

          <div className="inline-form">
            <input
              ref={percyInputRef}
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void sendPercyMessage() }}
              placeholder="Ask Percy about yourself, habits, or insights..."
              disabled={chatLoading}
              aria-label="Message for Percy"
            />
            <button
              className="primary-button"
              disabled={!chatInput.trim() || chatLoading}
              onClick={() => void sendPercyMessage()}
            >
              {chatLoading ? <span className="button-spinner" /> : <Send />} Ask
            </button>
          </div>
        </div>
      </Card>

      {savedPercyAdvice.length > 0 && (
        <Card title="Saved advice" icon={<Bookmark />} count={savedPercyAdvice.length}>
          <ul className="note-list">
            {savedPercyAdvice.map((item) => (
              <li key={item.id}>
                <div>
                  {item.context_question && <span className="card-eyebrow">You asked: {item.context_question}</span>}
                  <p>{item.advice_text}</p>
                </div>
                <button
                  className="icon-button"
                  disabled={deletingAdviceId === item.id}
                  onClick={() => void removeSavedAdvice(item.id)}
                  aria-label="Remove saved advice"
                  title="Remove"
                >
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Sheet>
  )
}
