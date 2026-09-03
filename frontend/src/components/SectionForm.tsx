import { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { SECTION_COLORS } from '../lib/sections'

export function SectionForm({
  initialName = '',
  initialColor = 'forest',
  submitLabel = 'Create',
  autoFocus = true,
  busy = false,
  onSubmit,
  onCancel,
}: {
  initialName?: string
  initialColor?: string
  submitLabel?: string
  autoFocus?: boolean
  busy?: boolean
  onSubmit: (name: string, color: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)

  return (
    <div className="section-form">
      <input
        className="section-form-name"
        value={name}
        placeholder="e.g. Biology 101"
        aria-label="Section name"
        autoFocus={autoFocus}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmit(name.trim(), color)
          if (event.key === 'Escape') onCancel()
        }}
      />
      <div className="section-swatches" role="radiogroup" aria-label="Section color">
        {SECTION_COLORS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={color === option.key}
            aria-label={option.label}
            title={option.label}
            className={`section-swatch section-swatch-${option.key}${color === option.key ? ' is-active' : ''}`}
            onClick={() => setColor(option.key)}
          />
        ))}
      </div>
      <div className="section-form-actions">
        <button
          className="primary-button"
          disabled={busy || !name.trim()}
          onClick={() => onSubmit(name.trim(), color)}
        >
          {busy ? <span className="button-spinner" /> : submitLabel === 'Create' ? <Plus /> : <Check />}
          {submitLabel}
        </button>
        <button className="icon-button" onClick={onCancel} aria-label="Cancel" title="Cancel">
          <X />
        </button>
      </div>
    </div>
  )
}
