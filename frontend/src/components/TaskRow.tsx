import { AlarmClock, Archive, Bell, Check, GripVertical, Plus, X } from 'lucide-react'
import type { Task } from '../api'
import { formatRemindAt } from '../lib/day'
import { taskProgress } from '../lib/entries'
import { useJournal } from '../state/journalContext'
import { GoalCheckboxes } from './ui/GoalCheckboxes'

type TaskRowProps = {
  task: Task
  draggable?: boolean
  /** While planning the day, rows pick tasks for today instead of completing them. */
  selectMode?: boolean
  selected?: boolean
}

export function TaskRow({ task, draggable = false, selectMode = false, selected = false }: TaskRowProps) {
  const {
    patchTask, updatingTaskId, acknowledgeHighlight, openScheduleModal, openSnoozeModal, toggleMorningTask,
    draggedTaskId, taskDropTarget, handleTaskDragStart, handleTaskDragOver, handleTaskDrop, clearTaskDrag,
  } = useJournal()
  const { isCompleted, targetCount, currentCount } = taskProgress(task)

  const classNames = ['row']
  if (isCompleted) classNames.push('row-done')
  if (task.just_resurfaced) classNames.push('row-highlight')
  if (selectMode && selected) classNames.push('row-picked')
  if (draggable && draggedTaskId === task.id) classNames.push('is-dragging')
  if (draggable && taskDropTarget?.id === task.id) classNames.push(`drop-${taskDropTarget.position}`)

  return (
    <li
      className={classNames.join(' ')}
      draggable={draggable}
      onDragStart={draggable ? (event) => handleTaskDragStart(event, task.id) : undefined}
      onDragOver={draggable ? (event) => handleTaskDragOver(event, task.id) : undefined}
      onDragEnd={draggable ? clearTaskDrag : undefined}
      onDrop={draggable ? (event) => {
        event.stopPropagation()
        if (!taskDropTarget || taskDropTarget.id !== task.id) return
        void handleTaskDrop(task.id, taskDropTarget.position)
      } : undefined}
    >
      {draggable && <span className="row-grip" aria-hidden="true"><GripVertical /></span>}

      {selectMode ? (
        <button
          className={selected ? 'row-pick picked' : 'row-pick'}
          onClick={() => toggleMorningTask(task.id)}
          aria-pressed={selected}
          aria-label={selected ? `Remove ${task.goal_text} from today` : `Add ${task.goal_text} to today`}
          title={selected ? 'Picked for today' : 'Add to today'}
        >
          {selected ? <Check /> : <Plus />}
        </button>
      ) : (
        <GoalCheckboxes
          targetCount={targetCount}
          currentCount={currentCount}
          onChange={(newCount) => { void patchTask(task, { current_count: newCount }) }}
        />
      )}

      <div className="row-body">
        <p>{task.goal_text}</p>
        {(task.remind_at || task.just_resurfaced) && (
          <div className="row-meta">
            {task.remind_at && (
              <span className="tag">
                <Bell /> {formatRemindAt(task.remind_at)}
                {task.has_calendar_reminder && ' \u00b7 on your calendar'}
              </span>
            )}
            {task.just_resurfaced && (
              <button className="tag tag-new" onClick={() => acknowledgeHighlight(task)}>
                Back on your radar <X />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="row-actions">
        <button
          className="icon-button"
          disabled={updatingTaskId === task.id}
          onClick={() => openScheduleModal(task)}
          aria-label={`Schedule a reminder for ${task.goal_text}`}
          title="Schedule reminder"
        >
          <Bell />
        </button>
        <button
          className="icon-button"
          disabled={updatingTaskId === task.id}
          onClick={() => openSnoozeModal(task)}
          aria-label={`Remind me later about ${task.goal_text}`}
          title="Remind me later"
        >
          <AlarmClock />
        </button>
        {isCompleted && (
          <button
            className="icon-button"
            disabled={updatingTaskId === task.id}
            onClick={() => patchTask(task, { status: 'abandoned' })}
            aria-label={`Archive ${task.goal_text}`}
            title="Archive"
          >
            <Archive />
          </button>
        )}
      </div>
    </li>
  )
}
