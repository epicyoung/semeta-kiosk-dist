type Props = {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

export function BottomSheet({ open, onClose, children }: Props) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 p-6 animate-slide-up max-h-[70dvh] overflow-y-auto" style={{ background: 'rgba(9,1,53,0.85)', backdropFilter: 'blur(24px)', borderTop: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 -8px 40px rgba(0,0,0,0.4)' }}>
        {children}
      </div>
    </>
  )
}
