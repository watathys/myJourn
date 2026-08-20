import type { ReactNode } from 'react'

export function Card({
  title, eyebrow, icon, count, actions, className = '', children,
}: {
  title: string
  eyebrow?: string
  icon?: ReactNode
  count?: number
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`card ${className}`.trim()}>
      <header className="card-head">
        <div className="card-head-title">
          {icon && <span className="card-icon">{icon}</span>}
          <div>
            {eyebrow && <p className="card-eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          {count !== undefined && count > 0 && <span className="count-pill">{count}</span>}
        </div>
        {actions && <div className="card-head-actions">{actions}</div>}
      </header>
      <div className="card-body">{children}</div>
    </section>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="empty-note">{children}</p>
}
