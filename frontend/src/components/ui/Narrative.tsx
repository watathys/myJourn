export function Narrative({ text }: { text: string }) {
  return (
    <div className="narrative">
      {text.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => {
        const clean = paragraph.replace(/^#+\s*/, '')
        if (/^#{1,3}\s/.test(paragraph)) return <h2 key={index}>{clean}</h2>
        if (paragraph.split('\n').every((line) => /^[-*]\s/.test(line))) {
          return (
            <ul key={index}>
              {paragraph.split('\n').map((line) => <li key={line}>{line.replace(/^[-*]\s/, '')}</li>)}
            </ul>
          )
        }
        return <p key={index}>{clean}</p>
      })}
    </div>
  )
}

export function AlignmentSummary({ text }: { text: string }) {
  const summary = text.replace(/^\s*(?:#{1,3}\s*)?What I(?:'|’)m Working On\s*:?\s*/i, '').trim()
  return summary ? <p className="alignment">{summary}</p> : null
}
