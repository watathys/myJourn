import { Archive, Bell, Check, GripVertical, Pencil, X } from 'lucide-react'
import type { Goal } from '../api'
import { formatRemindAt } from '../lib/day'
import { taskProgress } from '../lib/entries'
import { useJournal } from '../state/journalContext'
import { GoalCheckboxes } from './ui/GoalCheckboxes'

export function GoalRow({ goal, readOnly = false }: { goal: Goal; readOnly?: boolean }) {
  const {
    updatingGoalId, editingGoalId, setEditingGoalId, editGoalText, setEditGoalText, editGoalTarget,
    setEditGoalTarget, startEditingGoal, saveGoalEdit, updateGoalProgress, changeGoalStatus,
    openScheduleModal, draggedGoalId, goalDropTarget, handleGoalDragStart, handleGoalDragOver,
    handleGoalDrop, clearGoalDrag,
  } = useJournal()

  const { isCompleted, targetCount, currentCount } = taskProgress(goal)

  if (readOnly) {
    return (
      <li className={isCompleted ? 'row row-done' : 'row'}>
        <GoalCheckboxes targetCount={targetCount} currentCount={currentCount} disabled onChange={() => {}} />
        <div className="row-body"><p>{goal.goal_text}</p></div>
      </li>
    )
  }

  if (editingGoalId === goal.id) {
    return (
      <li className="row row-editing">
        <div className="goal-edit">
          <input
            value={editGoalText}
            onChange={(event) => setEditGoalText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveGoalEdit(goal)
              if (event.key === 'Escape') setEditingGoalId(null)
            }}
            placeholder="Goal"
            aria-label="Goal text"
            autoFocus
          />
          <label className="goal-edit-target">
            <span>Target</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={editGoalTarget}
              onChange={(event) => setEditGoalTarget(Number(event.target.value))}
              aria-label="Target count"
            />
          </label>
          <button
            className="icon-button"
            disabled={updatingGoalId === goal.id || !editGoalText.trim()}
            onClick={() => void saveGoalEdit(goal)}
            aria-label="Save goal"
            title="Save"
          >
            <Check />
          </button>
          <button
            className="icon-button"
            disabled={updatingGoalId === goal.id}
            onClick={() => setEditingGoalId(null)}
            aria-label="Cancel editing"
            title="Cancel"
          >
            <X />
          </button>
        </div>
      </li>
    )
  }

  const classNames = ['row']
  if (isCompleted) classNames.push('row-done')
  if (goal.just_resurfaced) classNames.push('row-highlight')
  if (draggedGoalId === goal.id) classNames.push('is-dragging')
  if (goalDropTarget?.id === goal.id) classNames.push(`drop-${goalDropTarget.position}`)

  return (
    <li
      className={classNames.join(' ')}
      draggable
      onDragStart={(event) => handleGoalDragStart(event, goal.id)}
      onDragOver={(event) => handleGoalDragOver(event, goal.id)}
      onDragEnd={clearGoalDrag}
      onDrop={() => {
        if (!goalDropTarget || goalDropTarget.id !== goal.id) return
        void handleGoalDrop(goal.id, goalDropTarget.position)
      }}
    >
      <span className="row-grip" aria-hidden="true"><GripVertical /></span>
      <GoalCheckboxes
        targetCount={targetCount}
        currentCount={currentCount}
        onChange={(newCount) => updateGoalProgress(goal, newCount)}
      />
      <div className="row-body">
        <p>{goal.goal_text}</p>
        {goal.remind_at && (
          <div className="row-meta">
            <span className="tag">
              <Bell /> {formatRemindAt(goal.remind_at)}
              {goal.has_calendar_reminder && ' \u00b7 on your calendar'}
            </span>
          </div>
        )}
      </div>
      <div className="row-actions">
        <button
          className="icon-button"
          disabled={updatingGoalId === goal.id}
          onClick={() => startEditingGoal(goal)}
          aria-label={`Edit ${goal.goal_text}`}
          title="Edit goal"
        >
          <Pencil />
        </button>
        <button
          className="icon-button"
          disabled={updatingGoalId === goal.id}
          onClick={() => openScheduleModal(goal, 'goal')}
          aria-label={`Schedule a reminder for ${goal.goal_text}`}
          title="Schedule reminder"
        >
          <Bell />
        </button>
        {isCompleted && (
          <button
            className="icon-button"
            disabled={updatingGoalId === goal.id}
            onClick={() => changeGoalStatus(goal, 'abandoned')}
            aria-label={`Archive ${goal.goal_text}`}
            title="Archive"
          >
            <Archive />
          </button>
        )}
      </div>
    </li>
  )
}
