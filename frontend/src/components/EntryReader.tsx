import { CalendarDays, Check, ChevronRight, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { formatDate, journalDay, weekAgo } from '../lib/day'
import { useJournal } from '../state/journalContext'
import { Narrative } from './ui/Narrative'
import { Sheet } from './ui/Sheet'

export function EntryReader() {
  const {
    activeEntry, closeEntry, editingNarrative, beginNarrativeEdit, cancelNarrativeEdit, narrativeDraft,
    setNarrativeDraft, savingNarrative, saveNarrativeEdit, editingDate, beginDateEdit, cancelDateEdit,
    dateDraft, setDateDraft, savingDate, saveDateEdit, deletingEntry, removeActiveEntry, continueThread,
    openComposer,
  } = useJournal()

  if (!activeEntry) return null

  const wins = activeEntry.completed_goals ?? []
  const followUps = activeEntry.follow_up_questions ?? []

  const isOverAWeekOld = activeEntry.date < weekAgo()

  return (
    <Sheet
      open={Boolean(activeEntry)}
      onClose={closeEntry}
      size="reader"
      level="reader"
      eyebrow={<><CalendarDays /> {formatDate(activeEntry.date)}</>}
      title={formatDate(activeEntry.date, true)}
      headerExtra={!editingNarrative && !editingDate ? (
        <div className="reader-tools">
          <button className="icon-button" onClick={beginDateEdit} title="Edit date" aria-label="Edit date">
            <CalendarDays />
          </button>
          <button className="icon-button" onClick={beginNarrativeEdit} title="Edit entry" aria-label="Edit entry">
            <Pencil />
          </button>
          <button
            className="icon-button danger"
            disabled={deletingEntry}
            onClick={removeActiveEntry}
            title="Delete entry"
            aria-label="Delete entry"
          >
            <Trash2 />
          </button>
        </div>
      ) : undefined}
    >
      {editingDate && (
        <div className="inline-form">
          <input
            type="date"
            aria-label="Entry date"
            value={dateDraft}
            max={journalDay()}
            onChange={(event) => setDateDraft(event.target.value)}
            autoFocus
          />
          <button className="ghost-button" disabled={savingDate} onClick={cancelDateEdit}>Cancel</button>
          <button className="primary-button" disabled={savingDate || !dateDraft} onClick={saveDateEdit}>
            {savingDate ? <span className="button-spinner" /> : <Check />} Save
          </button>
        </div>
      )}

      {activeEntry.praise_message && wins.length > 0 && (
        <div className="praise">
          <span><Sparkles /></span>
          <div>
            <strong>A win worth noticing</strong>
            <p>{activeEntry.praise_message}</p>
          </div>
        </div>
      )}

      {editingNarrative ? (
        <div className="editor">
          <textarea
            aria-label="Edit entry"
            value={narrativeDraft}
            onChange={(event) => setNarrativeDraft(event.target.value)}
            rows={16}
          />
          <div className="editor-bar">
            <button className="ghost-button" disabled={savingNarrative} onClick={cancelNarrativeEdit}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={savingNarrative || !narrativeDraft.trim() || narrativeDraft === activeEntry.formatted_narrative}
              onClick={saveNarrativeEdit}
            >
              {savingNarrative ? <span className="button-spinner" /> : <Check />} Save changes
            </button>
          </div>
        </div>
      ) : (
        <Narrative text={activeEntry.formatted_narrative} />
      )}

      {!editingNarrative && (
        <div className="reader-foot">
          <button
            className="ghost-button"
            onClick={() => openComposer({ prefill: '', append: { id: activeEntry.id, date: activeEntry.date } })}
          >
            <Plus /> Add to this entry
          </button>
        </div>
      )}

      {followUps.length > 0 && !isOverAWeekOld && !editingNarrative && (
        <section className="follow-ups">
          <div className="follow-ups-head">
            <h3><Sparkles className="sparkle-icon" /> Questions from Percy</h3>
            <p className="card-eyebrow">Click a thread to chat with Percy and dive deeper</p>
          </div>
          <div className="chips">
            {followUps.map((question) => (
              <button key={question} onClick={() => continueThread(activeEntry, question)}>
                <span>{question}</span><ChevronRight />
              </button>
            ))}
          </div>
        </section>
      )}
    </Sheet>
  )
}
