import { Plus } from 'lucide-react'
import { useJournal } from '../state/journalContext'

/** Shared "add a task" row. */
export function TaskForm({ placeholder = 'Add a task', onAdded }: { placeholder?: string; onAdded?: (id: string) => void }) {
  const {
    newTaskDraft, setNewTaskDraft, addingTask, addManualTask, sections, newTaskSectionId,
    setNewTaskSectionId, newTaskDueDate, setNewTaskDueDate,
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
        <label>
          <span>Due date (optional)</span>
          <input
            type="date"
            value={newTaskDueDate}
            onChange={(event) => setNewTaskDueDate(event.target.value)}
            aria-label="Task due date"
          />
        </label>
      </div>
    </div>
  )
}
