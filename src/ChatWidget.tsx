// Room chat: a floating messenger-style widget, alive wherever an online session is.
// Messages are session-only — the room's table talk dies with the room.
import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { useStore } from './store'

export function ChatWidget() {
  const online = useStore((s) => s.online)
  const chat = useStore((s) => s.chat)
  const sendChat = useStore((s) => s.sendChat)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [seen, setSeen] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // autoscroll + mark seen while open
  useEffect(() => {
    if (open) {
      setSeen(chat.length)
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
    }
  }, [chat.length, open])

  if (!online) return null
  const unread = chat.length - seen

  if (!open) {
    return (
      <button
        className="fixed right-4 bottom-20 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface2 shadow-xl transition-all hover:border-accent active:scale-95 md:bottom-4"
        onClick={() => setOpen(true)}
        title="Room chat"
      >
        <MessageCircle size={20} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="fixed right-4 bottom-20 z-40 flex h-[380px] w-[300px] flex-col overflow-hidden rounded-2xl border border-line bg-bg2/98 shadow-2xl backdrop-blur md:bottom-4">
      <div className="flex items-center justify-between border-b border-line/60 px-3 py-2">
        <b className="text-[13px]">Room {online.code} — chat</b>
        <button className="rounded p-1 text-mut hover:text-ink" onClick={() => setOpen(false)}>
          <X size={15} />
        </button>
      </div>
      <div ref={listRef} className="flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
        {chat.length === 0 && <div className="pt-4 text-center text-xs text-mut">Say something — the table can hear you.</div>}
        {chat.map((m) => (
          <div key={m.id} className={`max-w-[85%] ${m.self ? 'ml-auto text-right' : ''}`}>
            {!m.self && <div className="text-[10px] font-bold text-accent">{m.from}</div>}
            <div
              className={`inline-block rounded-xl px-2.5 py-1.5 text-[13px] leading-snug break-words ${
                m.self ? 'bg-accent text-white' : 'bg-surface2'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>
      <form
        className="flex gap-1.5 border-t border-line/60 p-2"
        onSubmit={(e) => {
          e.preventDefault()
          sendChat(draft)
          setDraft('')
        }}
      >
        <input
          value={draft}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the room…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
        />
        <button type="submit" className="rounded-lg bg-accent px-2.5 text-white disabled:opacity-40" disabled={!draft.trim()}>
          <Send size={15} />
        </button>
      </form>
    </div>
  )
}
