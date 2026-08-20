import { CalendarDays, ChevronRight, Mic, PenLine, Sparkles } from 'lucide-react'
import { formatDate, journalDay } from '../lib/day'
import { countWords } from '../lib/entries'
import { useJournal } from '../state/journalContext'
import { Sheet } from './ui/Sheet'

export function ComposerSheet() {
  const {
    composerOpen, closeComposer, draft, setDraft, entryDate, setEntryDate, appendTarget, saveVerbatim,
    setSaveVerbatim, generating, submitEntry, listening, toggleVoice, editorRef, userId, phase,
    plannedTasks, doneTodayCount,
  } = useJournal()

  if (!composerOpen) return null

  const isToday = entryDate === journalDay()
  const words = countWords(draft)

  return (
    <Sheet
      open={composerOpen}
      onClose={generating ? () => {} : closeComposer}
      size="reader"
      level="composer"
      eyebrow={<><PenLine /> {appendTarget ? 'Adding to an entry' : 'New entry'}</>}
      title={appendTarget
        ? 'Keep exploring'
        : phase === 'evening' && isToday ? 'Reflect on your day' : 'Write an entry'}
      subtitle={appendTarget
        ? 'This goes on the end of the same entry.'
        : 'Your words are saved exactly as you write them.'}
    >
      {generating ? (
        <div className="generating" role="status" aria-live="polite">
          <div className="generating-orbit"><Sparkles /></div>
          <h3>{saveVerbatim ? 'Saving your words' : 'Shaping your day into words'}</h3>
          <p>
            {saveVerbatim
              ? 'Keeping your journal exactly as you wrote it.'
              : 'Finding the moments, progress, and threads worth carrying forward.'}
          </p>
          <div className="generating-lines"><span /><span /><span /><span /></div>
        </div>
      ) : (
        <>
          {plannedTasks.length > 0 && (
            <p className="composer-context">
              You picked {plannedTasks.length} {plannedTasks.length === 1 ? 'task' : 'tasks'} for today
              and finished {doneTodayCount}.
            </p>
          )}

          <div className={listening ? 'editor listening' : 'editor'}>
            <textarea
              ref={editorRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={phase === 'evening' ? 'Today I...' : 'Right now I...'}
              aria-label="Journal entry"
            />
            <div className="editor-bar">
              <div className="editor-tools">
                <button className={listening ? 'ghost-button active' : 'ghost-button'} onClick={toggleVoice}>
                  <Mic /> {listening ? 'Listening...' : 'Voice'}
                </button>
                <label className="date-control">
                  <CalendarDays />
                  <span className="sr-only">Entry date</span>
                  <input
                    type="date"
                    value={entryDate}
                    disabled={Boolean(appendTarget)}
                    onChange={(event) => setEntryDate(event.target.value)}
                  />
                </label>
                {!isToday && !appendTarget && (
                  <span className="tag">Filing under {formatDate(entryDate)}</span>
                )}
              </div>
              <span className="word-count">{words} {words === 1 ? 'word' : 'words'}</span>
            </div>
          </div>

          <div className="composer-foot">
            <label className="switch">
              <input
                type="checkbox"
                checked={!saveVerbatim}
                onChange={(event) => setSaveVerbatim(!event.target.checked)}
              />
              <span>Let AI rewrite and reflect</span>
            </label>
            <p className="composer-hint">
              {saveVerbatim
                ? 'Saved word for word. Tasks and reminders in your text are still picked up.'
                : 'Percy will polish your entry and add follow-up questions.'}
            </p>
            <button className="primary-button large" disabled={!draft.trim() || !userId} onClick={submitEntry}>
              {appendTarget ? 'Add to this entry' : saveVerbatim ? 'Save to my journal' : 'Reflect on my day'}
              <ChevronRight />
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
