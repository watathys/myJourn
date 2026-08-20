import { NotebookPen, Plus, Trash2 } from 'lucide-react'
import { useJournal } from '../state/journalContext'
import { Card, EmptyNote } from './ui/Card'

export function RemindersCard() {
  const {
    percyReminders, newReminderDraft, setNewReminderDraft, addingReminder, addReminder, removeReminder,
  } = useJournal()

  return (
    <Card
      title="Notes for next week"
      eyebrow="Surfaces in weekly planning"
      icon={<NotebookPen />}
      count={percyReminders.length}
    >
      {percyReminders.length > 0 ? (
        <ul className="note-list">
          {percyReminders.map((reminder) => (
            <li key={reminder.id}>
              <p>{reminder.reminder_text}</p>
              <button
                className="icon-button"
                onClick={() => removeReminder(reminder.id)}
                aria-label="Remove reminder"
                title="Remove"
              >
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote>Anything you want to remember when you plan next week goes here.</EmptyNote>
      )}
      <div className="inline-form">
        <input
          value={newReminderDraft}
          onChange={(event) => setNewReminderDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void addReminder() }}
          placeholder="Remember to..."
          aria-label="Note for next week"
        />
        <button
          className="ghost-button"
          disabled={!newReminderDraft.trim() || addingReminder}
          onClick={addReminder}
        >
          {addingReminder ? <span className="button-spinner" /> : <Plus />} Add
        </button>
      </div>
    </Card>
  )
}
