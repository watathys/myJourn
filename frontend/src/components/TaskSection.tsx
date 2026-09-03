import { ChevronDown, ChevronRight, GripVertical, Pencil, Trash2 } from 'lucide-react'
import type { Task, TaskSection as Section } from '../api'
import { useJournal } from '../state/journalContext'
import { SectionForm } from './SectionForm'
import { TaskRow } from './TaskRow'

/** A collapsible, color-coded group of tasks. Pass `null` for the implicit
 * "Everything else" (unsectioned) group. */
export function TaskSection({ section, tasks }: { section: Section | null; tasks: Task[] }) {
  const {
    dayState, morningSelectedIds, sectionDropTarget, handleSectionDragOver, handleSectionDrop,
    collapsedSectionIds, toggleSectionCollapsed, editingSectionId, startEditingSection,
    cancelSectionEdit, saveSectionEdit, removeSection, draggedSectionId, sectionReorderTarget,
    handleSectionReorderDragStart, clearSectionReorderDrag,
  } = useJournal()

  const selecting = dayState === 'plan'
  const isUnsectioned = section === null
  const id = section?.id ?? 'unsectioned'
  const color = section?.color ?? 'slate'
  const name = section?.name ?? 'Everything else'
  const collapsed = !isUnsectioned && collapsedSectionIds.includes(section!.id)
  const isDropTarget = sectionDropTarget === id
  const isEditing = !isUnsectioned && editingSectionId === section!.id
  const isReordering = !isUnsectioned && draggedSectionId === section!.id
  const reorderPosition = sectionReorderTarget?.id === id ? sectionReorderTarget.position : null

  const classNames = ['section-group']
  if (collapsed) classNames.push('is-collapsed')
  if (isDropTarget) classNames.push('is-drop-target')
  if (isUnsectioned) classNames.push('is-unsectioned')
  if (isReordering) classNames.push('is-reordering')
  if (reorderPosition) classNames.push(`drop-${reorderPosition}`)

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
          onClick={() => { if (!isUnsectioned) toggleSectionCollapsed(section!.id) }}
          aria-expanded={!collapsed}
          disabled={isUnsectioned}
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
                onClick={() => startEditingSection(section!)}
                aria-label={`Edit ${name}`}
                title="Edit section"
              >
                <Pencil />
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

      {isEditing ? (
        <div className="section-body section-edit">
          <SectionForm
            initialName={section!.name}
            initialColor={section!.color}
            submitLabel="Save"
            onSubmit={(nextName, nextColor) => void saveSectionEdit(section!.id, nextName, nextColor)}
            onCancel={cancelSectionEdit}
          />
        </div>
      ) : !collapsed && (
        <div className="section-body">
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
