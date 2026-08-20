import { AlarmClock, ChevronDown, ChevronUp, ListChecks, Plus, RotateCcw, X } from 'lucide-react'
import { formatDate } from '../lib/day'
import { useJournal } from '../state/journalContext'
import { Card, EmptyNote } from './ui/Card'
import { TaskForm } from './TaskForm'
import { TaskRow } from './TaskRow'

export function TaskCard() {
  const {
    dayState, visibleTasks, plannedTasks, backlogTasks, snoozedTasks, morningSelectedIds,
    taskFormOpen, setTaskFormOpen, backlogOpen, setBacklogOpen, snoozedOpen, setSnoozedOpen, patchTask,
  } = useJournal()

  const selecting = dayState === 'plan'
  const showFocus = !selecting && plannedTasks.length > 0
  const listedTasks = selecting ? visibleTasks : backlogTasks
  const backlogExpanded = backlogOpen || !showFocus

  return (
    <Card
      title={selecting ? 'Your tasks' : 'Tasks'}
      eyebrow={selecting
        ? `${morningSelectedIds.length} picked for today`
        : showFocus ? 'Today first, then everything else' : 'What you’re working on'}
      icon={<ListChecks />}
      count={visibleTasks.length}
      actions={(
        <button
          className="text-button"
          onClick={() => setTaskFormOpen(!taskFormOpen)}
          aria-expanded={taskFormOpen}
        >
          {taskFormOpen ? <X /> : <Plus />} {taskFormOpen ? 'Close' : 'Add task'}
        </button>
      )}
    >
      {taskFormOpen && <TaskForm placeholder="What do you want to get done?" />}

      {showFocus && (
        <div className="task-group">
          <p className="group-label">Today</p>
          <ul className="rows">
            {plannedTasks.map((task) => <TaskRow key={task.id} task={task} />)}
          </ul>
        </div>
      )}

      {listedTasks.length > 0 ? (
        <div className="task-group">
          {showFocus && (
            <button
              className="group-toggle"
              onClick={() => setBacklogOpen(!backlogOpen)}
              aria-expanded={backlogExpanded}
            >
              <span>Also working on ({listedTasks.length})</span>
              {backlogExpanded ? <ChevronUp /> : <ChevronDown />}
            </button>
          )}
          {backlogExpanded && (
            <ul className="rows">
              {listedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  draggable={!selecting}
                  selectMode={selecting}
                  selected={morningSelectedIds.includes(task.id)}
                />
              ))}
            </ul>
          )}
        </div>
      ) : !showFocus && (
        <EmptyNote>
          Nothing here yet. Add a task above, or just write an entry — tasks you mention get picked up
          automatically.
        </EmptyNote>
      )}

      {snoozedTasks.length > 0 && (
        <div className="snoozed">
          <button
            className="group-toggle"
            onClick={() => setSnoozedOpen(!snoozedOpen)}
            aria-expanded={snoozedOpen}
          >
            <span><AlarmClock /> Snoozed ({snoozedTasks.length})</span>
            {snoozedOpen ? <ChevronUp /> : <ChevronDown />}
          </button>
          {snoozedOpen && (
            <ul className="snoozed-list">
              {snoozedTasks.map((task) => (
                <li key={task.id}>
                  <p>{task.goal_text}</p>
                  <span>{task.snoozed_until ? `Back on ${formatDate(task.snoozed_until)}` : 'Snoozed'}</span>
                  <button
                    className="icon-button"
                    onClick={() => patchTask(task, { snoozed_until: null, remind_at: null })}
                    aria-label={`Unsnooze ${task.goal_text}`}
                    title="Unsnooze"
                  >
                    <RotateCcw />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
