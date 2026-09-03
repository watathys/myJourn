import { AlarmClock, ChevronDown, ChevronUp, ListChecks, Plus, RotateCcw, X } from 'lucide-react'
import { formatDate } from '../lib/day'
import { useJournal } from '../state/journalContext'
import { Card, EmptyNote } from './ui/Card'
import { SectionForm } from './SectionForm'
import { TaskForm } from './TaskForm'
import { TaskRow } from './TaskRow'
import { TaskSection } from './TaskSection'

export function TaskCard() {
  const {
    dayState, visibleTasks, plannedTasks, backlogTasks, snoozedTasks, morningSelectedIds,
    taskFormOpen, setTaskFormOpen, snoozedOpen, setSnoozedOpen, patchTask,
    sections, sectionFormOpen, setSectionFormOpen, openSectionForm, addingSection, addSection,
  } = useJournal()

  const selecting = dayState === 'plan'
  const showFocus = !selecting && plannedTasks.length > 0
  const sectionSource = selecting ? visibleTasks : backlogTasks
  const unsectionedTasks = sectionSource.filter((task) => !task.section_id)

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

      {sections.map((section) => (
        <TaskSection
          key={section.id}
          section={section}
          tasks={sectionSource.filter((task) => task.section_id === section.id)}
        />
      ))}

      {(unsectionedTasks.length > 0 || sections.length === 0) && (
        <TaskSection section={null} tasks={unsectionedTasks} />
      )}

      {visibleTasks.length === 0 && (
        <EmptyNote>
          Nothing here yet. Add a task above, or just write an entry — tasks you mention get picked up
          automatically.
        </EmptyNote>
      )}

      {sectionFormOpen ? (
        <SectionForm
          submitLabel="Create"
          busy={addingSection}
          onSubmit={(name, color) => void addSection(name, color)}
          onCancel={() => setSectionFormOpen(false)}
        />
      ) : (
        <button className="text-button section-add" onClick={openSectionForm}>
          <Plus /> New section
        </button>
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
