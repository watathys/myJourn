import {
  Briefcase, CalendarDays, ChevronRight, Mic, PenLine, Sparkles, Target,
} from 'lucide-react'
import { formatDate, journalDay, weekAgo } from '../lib/day'
import { countWords } from '../lib/entries'
import { useJournal } from '../state/journalContext'
import { GoalRow } from './GoalRow'
import { TaskRow } from './TaskRow'
import { Narrative } from './ui/Narrative'

export function WriteView() {
  const {
    draft, setDraft, entryDate, setEntryDate, appendTarget, saveVerbatim,
    setSaveVerbatim, generating, submitEntry, listening, toggleVoice, editorRef, userId, phase,
    plannedTasks, visibleTasks, openGoals, doneTodayCount, activeEntry, continueThread,
    openComposer, goHome,
  } = useJournal()

  const isToday = entryDate === journalDay()
  const words = countWords(draft)

  const workingTasks = plannedTasks.length > 0 ? plannedTasks : visibleTasks

  // Render saved latest entry after submission / AI processing
  if (activeEntry) {
    const isOverAWeekOld = activeEntry.date < weekAgo()
    const followUps = activeEntry.follow_up_questions ?? []
    const wins = activeEntry.completed_goals ?? []

    return (
      <div className="write-page">
        <header className="write-header">
          <div className="eyebrow"><Sparkles /> Journal entry saved</div>
          <h1>{formatDate(activeEntry.date, true)}</h1>
        </header>

        {activeEntry.praise_message && wins.length > 0 && (
          <div className="praise">
            <span><Sparkles /></span>
            <div>
              <strong>A win worth noticing</strong>
              <p>{activeEntry.praise_message}</p>
            </div>
          </div>
        )}

        <div className="write-card entry-saved-card">
          <Narrative text={activeEntry.formatted_narrative} />

          <div className="saved-entry-actions">
            <button
              className="ghost-button"
              onClick={() => openComposer({ prefill: '', append: { id: activeEntry.id, date: activeEntry.date } })}
            >
              Add to this entry
            </button>
            <button className="primary-button" onClick={() => openComposer({ prefill: '' })}>
              Write another entry
            </button>
            <button className="ghost-button" onClick={goHome}>
              Back to Today
            </button>
          </div>
        </div>

        {followUps.length > 0 && !isOverAWeekOld && (
          <section className="follow-ups write-card">
            <h3>A few threads to explore</h3>
            <div className="chips">
              {followUps.map((question) => (
                <button key={question} onClick={() => continueThread(activeEntry, question)}>
                  <span>{question}</span><ChevronRight />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    )
  }

  return (
    <div className="write-page">
      <header className="write-header">
        <div className="eyebrow"><PenLine /> {appendTarget ? 'Adding to an entry' : 'Journaling'}</div>
        <h1>
          {appendTarget
            ? 'Keep exploring'
            : phase === 'evening' && isToday ? 'Reflect on your day' : 'Write an entry'}
        </h1>
        <p className="write-subtitle">
          {appendTarget
            ? 'This goes on the end of the same entry.'
            : 'Your words are saved exactly as you write them.'}
        </p>
      </header>

      {generating ? (
        <div className="generating write-card" role="status" aria-live="polite">
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
        <div className="write-card editor-card">
          {plannedTasks.length > 0 && (
            <p className="composer-context">
              You picked {plannedTasks.length} {plannedTasks.length === 1 ? 'task' : 'tasks'} for today
              and finished {doneTodayCount}.
            </p>
          )}

          <div className={listening ? 'editor listening big-editor' : 'editor big-editor'}>
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
        </div>
      )}

      {/* Underneath section: Things I'm working on & Goals */}
      <div className="write-underneath">
        <section className="write-section card">
          <div className="card-head">
            <div>
              <div className="eyebrow"><Briefcase /> Things I'm working on</div>
              <h2>Tasks</h2>
            </div>
          </div>
          {workingTasks.length > 0 ? (
            <ul className="list">
              {workingTasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          ) : (
            <p className="empty-note">No active tasks right now.</p>
          )}
        </section>

        <section className="write-section card">
          <div className="card-head">
            <div>
              <div className="eyebrow"><Target /> Goals</div>
              <h2>Weekly Goals</h2>
            </div>
          </div>
          {openGoals.length > 0 ? (
            <ul className="list">
              {openGoals.map((goal) => (
                <GoalRow key={goal.id} goal={goal} />
              ))}
            </ul>
          ) : (
            <p className="empty-note">No active goals set for this week.</p>
          )}
        </section>
      </div>
    </div>
  )
}
