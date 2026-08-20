import { Check } from 'lucide-react'

export function GoalCheckboxes({
  targetCount, currentCount, disabled, onChange,
}: {
  targetCount: number
  currentCount: number
  disabled?: boolean
  onChange: (newCount: number) => void
}) {
  if (targetCount <= 1) {
    const isCompleted = currentCount >= 1
    return (
      <button
        className="goal-check"
        disabled={disabled}
        onClick={() => onChange(isCompleted ? 0 : 1)}
        aria-label={isCompleted ? 'Mark incomplete' : 'Mark complete'}
        aria-pressed={isCompleted}
      >
        {isCompleted && <Check />}
      </button>
    )
  }

  return (
    <div className="goal-checkbox-group">
      {Array.from({ length: targetCount }, (_, index) => {
        const step = index + 1
        const isChecked = step <= currentCount
        return (
          <button
            key={step}
            type="button"
            className={isChecked ? 'goal-multi-check checked' : 'goal-multi-check'}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation()
              onChange(isChecked && step === currentCount ? step - 1 : step)
            }}
            title={`Check ${step} of ${targetCount}`}
            aria-label={`Check step ${step} of ${targetCount}`}
          >
            {isChecked && <Check />}
          </button>
        )
      })}
      <span className="goal-count-badge">{currentCount}/{targetCount}</span>
    </div>
  )
}
