import { useState } from 'react'
import { ChevronDown, ChevronRight, GripVertical, Plus, Trash2, X } from 'lucide-react'
import type { Task, TaskSection as Section } from '../api'
import { useJournal } from '../state/journalContext'
import { TaskRow } from './TaskRow'

/** A collapsible, color-coded group of tasks. Pass `null` for the implicit
 * "Everything else" (unsectioned) group. */
export function TaskSection({ section, tasks }: { section: Section | null; tasks: Task[] }) {
  const {
    dayState, morningSelectedIds, sectionDropTarget, handleSectionDragOver, handleSectionDrop,
    collapsedSectionIds, toggleSectionCollapsed, removeSection, draggedSectionId, sectionReorderTarget,
    handleSectionReorderDragStart, clearSectionReorderDrag, addTaskToSection, addingTask,
  } = useJournal()

  const [addOpen, setAddOpen] = useState(false)
  const [addDraft, setAddDraft] = useState('')
  const [addDueDate, setAddDueDate] = useState('')

  const selecting = dayState === 'plan'
  const isUnsectioned = section === null
  const id = section?.id ?? 'unsectioned'
  const color = section?.color ?? 'slate'
  const name = section?.name ?? 'Everything else'
  const collapsed = collapsedSectionIds.includes(id)
  const isDropTarget = sectionDropTarget === id
  const isReordering = !isUnsectioned && draggedSectionId === section!.id
  const reorderPosition = sectionReorderTarget?.id === id ? sectionReorderTarget.position : null
  // Dropping onto "Everything else" moves the section to the end of the list;
  // highlight that whole group so the intent is visible even when it is tall.
  const isReorderEnd = isUnsectioned && sectionReorderTarget?.id === 'unsectioned'

  const classNames = ['section-group']
  if (collapsed) classNames.push('is-collapsed')
  if (isDropTarget) classNames.push('is-drop-target')
  if (isUnsectioned) classNames.push('is-unsectioned')
  if (isReordering) classNames.push('is-reordering')
  if (reorderPosition) classNames.push(`drop-${reorderPosition}`)
  if (isReorderEnd) classNames.push('is-reorder-end')

  function closeQuickAdd() {
    setAddOpen(false)
    setAddDraft('')
    setAddDueDate('')
  }

  function toggleQuickAdd() {
    if (addOpen) {
      closeQuickAdd()
      return
    }
    setAddOpen(true)
    if (collapsed) toggleSectionCollapsed(id)
  }

  async function submitQuickAdd() {
    if (!section || addingTask) return
    const clean = addDraft.trim()
    if (!clean) return
    const created = await addTaskToSection(section.id, clean, addDueDate.trim() || undefined)
    if (created) {
      setAddDraft('')
      setAddDueDate('')
    }
  }

  return (
    <div
      className={classNames.join(' ')}
      data-color={color}
      onDragOver={(event) => handleSectionDragOver(event, id)}
      onDrop={() => handleSectionDrop(id)}
    >
      <div className="section-head">
        <button
          className="section-toggle"
          onClick={() => toggleSectionCollapsed(id)}
          // The whole header (not just the grip) starts a reorder, so dragging
          // a category is easy to find and the drag ghost shows its name.
          draggable={!isUnsectioned}
          onDragStart={!isUnsectioned ? (event) => handleSectionReorderDragStart(event, section!.id) : undefined}
          onDragEnd={!isUnsectioned ? clearSectionReorderDrag : undefined}
          aria-expanded={!collapsed}
          title={isUnsectioned ? undefined : 'Drag to reorder · click to collapse'}
        >
          {collapsed ? <ChevronRight /> : <ChevronDown />}
          <span className="section-dot" aria-hidden="true" />
          <span className="section-name">{name}</span>
          <span className="section-count">{tasks.length}</span>
        </button>
        {!isUnsectioned && (
          <>
            <div className="section-actions">
              <button
                className="icon-button"
                onClick={toggleQuickAdd}
                aria-label={addOpen ? `Close new task field for ${name}` : `Add a task to ${name}`}
                title={addOpen ? 'Close add task' : 'Add a task'}
              >
                {addOpen ? <X /> : <Plus />}
              </button>
              <button
                className="icon-button"
                onClick={() => {
                  if (window.confirm(`Delete "${name}"? Its tasks will move to Everything else.`)) {
                    void removeSection(section!.id)
                  }
                }}
                aria-label={`Delete ${name}`}
                title="Delete section"
              >
                <Trash2 />
              </button>
            </div>
            <span
              className="section-grip"
              draggable
              onDragStart={(event) => handleSectionReorderDragStart(event, section!.id)}
              onDragEnd={clearSectionReorderDrag}
              title="Drag to reorder sections"
              aria-label={`Reorder ${name}`}
            >
              <GripVertical />
            </span>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="section-body">
          {addOpen && section && (
            <div className="task-form section-quick-add">
              <div className="task-form-main">
                <input
                  value={addDraft}
                  onChange={(event) => setAddDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submitQuickAdd()
                    if (event.key === 'Escape') closeQuickAdd()
                  }}
                  placeholder={`Add to ${name}`}
                  aria-label={`New task in ${name}`}
                  autoFocus
                />
                <input
                  type="date"
                  className="quick-add-due"
                  value={addDueDate}
                  onChange={(event) => setAddDueDate(event.target.value)}
                  aria-label={`Due date for new task in ${name}`}
                  title="Due date (optional)"
                />
                <button
                  className="primary-button"
                  disabled={!addDraft.trim() || addingTask}
                  onClick={() => void submitQuickAdd()}
                  type="button"
                >
                  {addingTask ? <span className="button-spinner" /> : <Plus />} Add
                </button>
              </div>
            </div>
          )}
          {tasks.length > 0 ? (
            <ul className="rows">
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  draggable={!selecting}
                  selectMode={selecting}
                  selected={morningSelectedIds.includes(task.id)}
                />
              ))}
            </ul>
          ) : (
            <p className="section-empty">{selecting ? 'No tasks here yet' : 'Drag tasks here'}</p>
          )}
        </div>
      )}
    </div>
  )
}
