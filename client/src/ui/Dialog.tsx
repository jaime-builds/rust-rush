import { MouseEventHandler, ReactNode, useEffect, useRef } from 'react'

// Modal dialog shell for the game's overlays (settings, map select, game
// over, victory). On open it moves focus to the first control, keeps Tab
// inside the dialog, closes on Escape when onClose is given, and gives focus
// back to whatever had it before. role="dialog" is also what the board's
// hotkey handler checks, so keys never leak through to the board underneath.

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface DialogProps {
  className: string
  labelledBy: string
  onClose?: () => void
  onBackdropClick?: MouseEventHandler<HTMLDivElement>
  children: ReactNode
}

const Dialog = ({ className, labelledBy, onClose, onBackdropClick, children }: DialogProps) => {
  const ref = useRef<HTMLDivElement>(null)
  // Latest onClose without re-running the focus effect when it changes.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const previous = document.activeElement as HTMLElement | null
    const items = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    items()[0]?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onCloseRef.current) {
          e.preventDefault()
          onCloseRef.current()
        }
        return
      }
      if (e.key !== 'Tab') return
      const list = items()
      if (list.length === 0) return
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      if (!root.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (previous && document.contains(previous)) previous.focus()
    }
  }, [])

  return (
    <div
      ref={ref}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={onBackdropClick}
    >
      {children}
    </div>
  )
}

export default Dialog
