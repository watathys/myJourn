import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

type SheetProps = {
  open: boolean
  onClose: () => void
  side?: 'left' | 'right'
  size?: 'narrow' | 'wide' | 'reader'
  eyebrow?: ReactNode
  title: string
  subtitle?: string
  level?: 'panel' | 'reader' | 'composer'
  headerExtra?: ReactNode
  children: ReactNode
}

/** A slide-over surface. Everything that isn't the home dashboard lives in one of these. */
export function Sheet({
  open, onClose, side = 'right', size = 'narrow', eyebrow, title, subtitle,
  level = 'panel', headerExtra, children,
}: SheetProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={`sheet-layer sheet-layer-${level}`}>
      <button className="sheet-scrim" onClick={onClose} aria-label={`Close ${title}`} />
      <section
        className={`sheet sheet-${side} sheet-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="sheet-head">
          <div className="sheet-head-text">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="sheet-head-actions">
            {headerExtra}
            <button className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
          </div>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  )
}
