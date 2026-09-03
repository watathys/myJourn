import { useState } from 'react'
import { CalendarPlus, Check, Link2, Sparkles } from 'lucide-react'
import { useJournal } from '../state/journalContext'
import { Card } from './ui/Card'

export function CalendarAddCard() {
  const {
    addCalendarPrompt, addingCalendarBatch, googleStatus, connectGoogle, connectingGoogle,
  } = useJournal()

  const [promptInput, setPromptInput] = useState('')
  const [lastSummary, setLastSummary] = useState('')

  const handleAdd = async () => {
    if (!promptInput.trim() || addingCalendarBatch) return
    try {
      const res = await addCalendarPrompt(promptInput.trim())
      if (res?.summary_message) {
        setLastSummary(res.summary_message)
      }
      setPromptInput('')
    } catch {
      // Error is displayed via error toast in useJournal
    }
  }

  const examplePrompt = "remind me friday, saturday, sunday, and monday, at 8am, 12pm, 4pm, and 8pm to take creatine"

  return (
    <Card
      title="Add to Calendar"
      eyebrow={googleStatus?.connected ? `Google Calendar: ${googleStatus.email || 'Connected'}` : 'Natural Language Scheduling'}
      icon={<CalendarPlus />}
      actions={
        !googleStatus?.connected ? (
          <button
            className="text-button"
            onClick={connectGoogle}
            disabled={connectingGoogle}
            title="Connect Google Calendar"
          >
            <Link2 /> {connectingGoogle ? 'Connecting...' : 'Connect Google'}
          </button>
        ) : undefined
      }
    >
      <div className="calendar-add-body">
        <p className="calendar-add-intro">
          Schedule reminders across days & times in plain English:
        </p>

        <div className="calendar-add-form">
          <textarea
            value={promptInput}
            onChange={(e) => {
              setPromptInput(e.target.value)
              if (lastSummary) setLastSummary('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void handleAdd()
              }
            }}
            placeholder='e.g. "remind me friday, saturday, sunday, and monday, at 8am, 12pm, 4pm, and 8pm to take creatine"'
            rows={2}
            aria-label="Calendar reminder prompt"
          />
          <div className="calendar-add-actions">
            <button
              className="text-button"
              onClick={() => {
                setPromptInput(examplePrompt)
                if (lastSummary) setLastSummary('')
              }}
              type="button"
            >
              <Sparkles /> Use example
            </button>
            <button
              className="primary-button"
              disabled={!promptInput.trim() || addingCalendarBatch}
              onClick={handleAdd}
            >
              {addingCalendarBatch ? (
                <>
                  <span className="button-spinner" /> Scheduling...
                </>
              ) : (
                <>
                  <CalendarPlus /> Add to calendar
                </>
              )}
            </button>
          </div>
        </div>

        {lastSummary && (
          <div className="calendar-add-success" role="status">
            <Check className="calendar-success-icon" />
            <p>{lastSummary}</p>
          </div>
        )}
      </div>
    </Card>
  )
}
