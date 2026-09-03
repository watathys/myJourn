import { Plus } from 'lucide-react'
import { durationMinutesFromTimes, endTimeFromRemindAt } from '../lib/day'
import { useJournal } from '../state/journalContext'

/** Shared "add a task" row. Times are optional and only exist to place a calendar event. */
export function TaskForm({ placeholder = 'Add a task', onAdded }: { placeholder?: string; onAdded?: (id: string) => void }) {
  const {
    newTaskDraft, setNewTaskDraft, newTaskStartTime, setNewTaskStartTime, newTaskEndTime,
    setNewTaskEndTime, addingTask, addManualTask, todayIso, sections, newTaskSectionId,
    setNewTaskSectionId,
  } = useJournal()

  async function submit() {
    const task = await addManualTask()
    if (task && onAdded) onAdded(task.id)
  }

  return (
    <div className="task-form">
      <div className="task-form-main">
        <input
          value={newTaskDraft}
          onChange={(event) => setNewTaskDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void submit() }}
          placeholder={placeholder}
          aria-label="New task"
        />
        <button className="primary-button" disabled={!newTaskDraft.trim() || addingTask} onClick={() => void submit()}>
          {addingTask ? <span className="button-spinner" /> : <Plus />} Add
        </button>
      </div>
      <div className="task-form-section">
        <label>
          <span>Section</span>
          <select
            value={newTaskSectionId}
            onChange={(event) => setNewTaskSectionId(event.target.value)}
            aria-label="Task section"
          >
            <option value="">No section</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>{section.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="task-form-times">
        <label>
          <span>Start</span>
          <input
            type="time"
            value={newTaskStartTime}
            onChange={(event) => {
              const next = event.target.value
              setNewTaskStartTime(next)
              if (!next) {
                setNewTaskEndTime('')
                return
              }
              if (newTaskEndTime && durationMinutesFromTimes(next, newTaskEndTime) == null) {
                setNewTaskEndTime(endTimeFromRemindAt(`${todayIso}T${next}:00Z`, 60))
              }
            }}
            aria-label="Optional start time for calendar"
          />
        </label>
        <label>
          <span>End</span>
          <input
            type="time"
            value={newTaskEndTime}
            onChange={(event) => setNewTaskEndTime(event.target.value)}
            disabled={!newTaskStartTime}
            aria-label="Optional end time for calendar"
          />
        </label>
        <p>{newTaskStartTime ? 'Adds this to your calendar today' : 'Times are optional'}</p>
      </div>
    </div>
  )
}
