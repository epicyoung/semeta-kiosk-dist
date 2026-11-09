'use client'
import { useEffect, useRef, type RefObject } from 'react'

const modals: HTMLElement[] = []
const backgrounds = new Map<HTMLElement, boolean>()
function isolateTopModal() {
  for (const [element, wasInert] of backgrounds) {
    if (!wasInert) element.removeAttribute('inert')
  }
  backgrounds.clear()
  const top = modals.at(-1)
  for (const modal of modals) modal.setAttribute('aria-modal', modal === top ? 'true' : 'false')
  if (!top) return
  let branch: HTMLElement = top
  while (branch.parentElement) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (sibling !== branch && sibling instanceof HTMLElement) {
        backgrounds.set(sibling, sibling.hasAttribute('inert'))
        sibling.setAttribute('inert', '')
      }
    }
    if (branch.parentElement === document.body) break
    branch = branch.parentElement
  }
}

export function useModalFocus(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = ref.current
    if (!root) return
    modals.push(root)
    isolateTopModal()
    const observer = new MutationObserver(isolateTopModal)
    observer.observe(document.body, { childList: true, subtree: true })
    root?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (modals.at(-1) !== root) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return }
      if (event.key !== 'Tab' || !root) return
      const items = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]'))
      if (!items.length) { event.preventDefault(); root.focus(); return }
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) { event.preventDefault(); first.focus() }
    }
    const focusin = (event: FocusEvent) => { if (modals.at(-1) === root && !root.contains(event.target as Node)) root.focus() }
    document.addEventListener('keydown', keydown)
    document.addEventListener('focusin', focusin)
    return () => {
      observer.disconnect(); document.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin)
      const index = modals.indexOf(root)
      if (index !== -1) modals.splice(index, 1)
      isolateTopModal(); previous?.focus()
    }
  }, [ref])
}
