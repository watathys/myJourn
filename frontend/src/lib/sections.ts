export type SectionColor = {
  key: string
  label: string
}

/** The palette of section colors, chosen to sit comfortably next to the app's
 * muted, paper-like theme. Keys map to CSS variables (see App.css). */
export const SECTION_COLORS: SectionColor[] = [
  { key: 'forest', label: 'Forest' },
  { key: 'sage', label: 'Sage' },
  { key: 'amber', label: 'Amber' },
  { key: 'clay', label: 'Clay' },
  { key: 'sky', label: 'Sky' },
  { key: 'violet', label: 'Violet' },
  { key: 'rose', label: 'Rose' },
  { key: 'slate', label: 'Slate' },
]

export function sectionColorLabel(key: string): string {
  return SECTION_COLORS.find((color) => color.key === key)?.label ?? 'Forest'
}
