'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Repo {
  id: number
  name: string
  description: string | null
  liveUrl: string | null
  vercelProjectId: string | null
  updatedAt: string
}

interface SelectedElement {
  tag: string
  classes: string
  text: string
  id: string
}

interface Message {
  role: 'user' | 'rosie'
  content: string
  ts: number
  steps?: ProgressStep[]
}

interface ProgressStep {
  label: string
  state: 'pending' | 'active' | 'done' | 'error'
}

type DeployState = 'idle' | 'waiting' | 'building' | 'live'

const EDIT_STEPS = [
  'Analyzing element',
  'Searching source files',
  'Planning edit',
  'Applying changes',
  'Pushing to GitHub',
]

export default function Editor() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(true)
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
  const [search, setSearch] = useState('')
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null)
  const [instruction, setInstruction] = useState('')
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('canvas_messages') || '[]') } catch { return [] }
  })
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState<ProgressStep[]>([])
  const [deployState, setDeployState] = useState<DeployState>('idle')
  const [undoData, setUndoData] = useState<{repo: string; file: string; content: string; description: string} | null>(null)
  const [undoing, setUndoing] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    fetch('/api/repos').then(r => r.json()).then(data => { setRepos(data); setLoadingRepos(false) }).catch(() => setLoadingRepos(false))
  }, [])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'ELEMENT_SELECTED') setSelectedElement(e.data.element)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, progress])

  // Persist messages to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      try { localStorage.setItem('canvas_messages', JSON.stringify(messages.slice(-50))) } catch {}
    }
  }, [messages])

  const filteredRepos = repos.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))

  function advanceProgress(steps: ProgressStep[], currentIndex: number): ProgressStep[] {
    return steps.map((s, i) => ({
      ...s,
      state: i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending'
    }))
  }

  async function sendEdit() {
    if (!instruction.trim() || !selectedRepo || sending) return
    setSending(true)
    setDeployState('idle')

    const userMsg: Message = { role: 'user', content: instruction, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInstruction('')

    // Init progress steps
    const steps: ProgressStep[] = EDIT_STEPS.map((label, i) => ({
      label, state: i === 0 ? 'active' : 'pending'
    }))
    setProgress(steps)

    // Animate through steps with timing that mirrors real work
    const stepTimings = [600, 1200, 2000, 3500, 0] // 0 = wait for real result

    for (let i = 1; i < EDIT_STEPS.length - 1; i++) {
      await new Promise(r => setTimeout(r, stepTimings[i - 1]))
      setProgress(p => advanceProgress(p, i))
    }

    try {
      // Move to "Applying changes"
      setProgress(p => advanceProgress(p, 3))

      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: selectedRepo.name,
          element: selectedElement,
          instruction,
        })
      })
      const data = await res.json()

      if (data.success) {
        setProgress(EDIT_STEPS.map((label, i) => ({ label, state: 'done' as const })))
        const reply = `✅ **${data.description}**\nPushed to GitHub · commit \`${data.commit}\``
        setMessages(prev => [...prev, { role: 'rosie', content: reply, ts: Date.now() }])
        // Store undo data
        if (data.undo) setUndoData(data.undo)
        if (selectedRepo.vercelProjectId) {
          setDeployState('waiting')
          pollDeploy(selectedRepo.vercelProjectId, Date.now())
        }
        // Also trigger deploy polling for direct-deployed repos
        setDeployState('building')
        setTimeout(() => setDeployState('live'), 40000)
      } else {
        setProgress(EDIT_STEPS.map((label, i) => ({
          label, state: i < 3 ? 'done' as const : i === 3 ? 'error' as const : 'pending' as const
        })))
        setMessages(prev => [...prev, {
          role: 'rosie',
          content: `❌ ${data.error || 'Edit failed'}${data.rosieReply ? '\n\n' + data.rosieReply.slice(0, 300) : ''}`,
          ts: Date.now()
        }])
      }
    } catch (e) {
      setProgress(EDIT_STEPS.map((label, i) => ({ label, state: i === 0 ? 'error' as const : 'pending' as const })))
      setMessages(prev => [...prev, { role: 'rosie', content: '❌ Connection error. Try again.', ts: Date.now() }])
    } finally {
      setSending(false)
      setTimeout(() => setProgress([]), 3000)
    }
  }

  async function pollDeploy(projectId: string, startTime: number) {
    if (Date.now() - startTime > 5 * 60 * 1000) { setDeployState('idle'); return }
    const res = await fetch(`/api/deploy-status?projectId=${projectId}`)
    const data = await res.json()
    if (data.state === 'READY') {
      setDeployState('live')
      setTimeout(() => {
        if (iframeRef.current && selectedRepo?.liveUrl) {
          iframeRef.current.src = `/api/proxy?url=${encodeURIComponent(selectedRepo.liveUrl + '?nocache=' + Date.now())}`
        }
      }, 2000)
    } else if (['BUILDING', 'INITIALIZING', 'QUEUED'].includes(data.state)) {
      setDeployState('building')
      setTimeout(() => pollDeploy(projectId, startTime), 5000)
    } else {
      setTimeout(() => pollDeploy(projectId, startTime), 8000)
    }
  }

  async function handleUndo() {
    if (!undoData || undoing) return
    setUndoing(true)
    try {
      const res = await fetch('/api/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(undoData)
      })
      const data = await res.json()
      if (data.success) {
        setMessages(prev => [...prev, { role: 'rosie', content: `↩️ Reverted "${undoData.description}" (commit ${data.commit})`, ts: Date.now() }])
        setUndoData(null)
        setDeployState('building')
        setTimeout(() => setDeployState('live'), 40000)
      } else {
        setMessages(prev => [...prev, { role: 'rosie', content: `❌ Undo failed: ${data.error}`, ts: Date.now() }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'rosie', content: '❌ Undo connection error.', ts: Date.now() }])
    } finally {
      setUndoing(false)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex h-screen bg-[#1a1a2e] overflow-hidden font-sans">

      {/* LEFT SIDEBAR */}
      <div className="w-60 flex-shrink-0 bg-[#16213e] border-r border-[#0f3460]/60 flex flex-col">
        <div className="px-4 py-3.5 border-b border-[#0f3460]/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="4" height="4" rx="0.5" fill="white" fillOpacity="0.9"/><rect x="7" y="1" width="4" height="4" rx="0.5" fill="white" fillOpacity="0.5"/><rect x="1" y="7" width="4" height="4" rx="0.5" fill="white" fillOpacity="0.5"/><rect x="7" y="7" width="4" height="4" rx="0.5" fill="white" fillOpacity="0.9"/></svg>
            </div>
            <span className="text-white font-semibold text-sm tracking-tight">Canvas</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setMessages([]); localStorage.removeItem('canvas_messages') }} className="text-[11px] text-[#4a5568] hover:text-[#a0aec0] transition-colors">Clear</button>
            <span className="text-[#2d3748]">·</span>
            <button onClick={signOut} className="text-[11px] text-[#4a5568] hover:text-[#a0aec0] transition-colors">Sign out</button>
          </div>
        </div>

        <div className="px-3 pt-3 pb-1.5">
          <div className="relative">
            <svg className="absolute left-2.5 top-2 w-3.5 h-3.5 text-[#4a5568]" fill="none" viewBox="0 0 16 16"><path d="M6.5 11a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM14 14l-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            <input type="text" placeholder="Filter repos..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-[#0f1b35] border border-[#0f3460]/50 rounded-md pl-7 pr-3 py-1.5 text-[12px] text-[#a0aec0] placeholder-[#4a5568] outline-none focus:border-[#7c3aed]/60 transition-colors" />
          </div>
        </div>

        <div className="px-2 pb-1">
          <div className="text-[10px] font-semibold text-[#4a5568] uppercase tracking-widest px-2 py-1.5">Repositories</div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {loadingRepos ? (
            <div className="flex items-center gap-2 px-2 py-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-pulse"></div>
              <span className="text-[11px] text-[#4a5568]">Loading...</span>
            </div>
          ) : filteredRepos.map(repo => (
            <button key={repo.id} onClick={() => { setSelectedRepo(repo); setSelectedElement(null); setProgress([]); if (messages.length > 0) setMessages(prev => [...prev, { role: 'rosie' as const, content: '— ' + repo + ' —', ts: Date.now() }]) }}
              className={`w-full text-left px-2.5 py-2 rounded-md transition-all group ${
                selectedRepo?.id === repo.id
                  ? 'bg-[#7c3aed]/20 text-white'
                  : 'hover:bg-[#0f3460]/40 text-[#718096]'
              }`}>
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${repo.liveUrl ? 'bg-emerald-400' : 'bg-[#4a5568]'}`}></div>
                <span className="text-[12px] font-medium truncate">{repo.name}</span>
              </div>
              {repo.liveUrl && (
                <div className="text-[10px] text-[#4a5568] truncate mt-0.5 pl-3.5">{repo.liveUrl.replace('https://', '')}</div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* CENTER PREVIEW */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-9 bg-[#16213e] border-b border-[#0f3460]/60 flex items-center px-4 gap-3">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/70"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/70"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/70"></div>
          </div>
          <div className="flex-1 bg-[#0f1b35] border border-[#0f3460]/50 rounded px-2.5 py-0.5 text-[11px] text-[#4a5568] font-mono truncate">
            {selectedRepo?.liveUrl || 'select a project'}
          </div>
          {deployState !== 'idle' && (
            <div className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded ${
              deployState === 'live'
                ? 'text-emerald-400 bg-emerald-400/10'
                : 'text-amber-400 bg-amber-400/10'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${deployState === 'live' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`}></span>
              {deployState === 'live' ? 'Live' : 'Deploying...'}
            </div>
          )}
        </div>

        <div className="flex-1 relative bg-[#1a1a2e]">
          {selectedRepo?.liveUrl ? (
            <iframe
              ref={iframeRef}
              src={`/api/proxy?url=${encodeURIComponent(selectedRepo.liveUrl)}`}
              className="w-full h-full border-0"
              title="Preview"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <div className="w-12 h-12 rounded-xl bg-[#7c3aed]/20 flex items-center justify-center mx-auto">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="7" rx="1" fill="#7c3aed" fillOpacity="0.6"/><rect x="11" y="2" width="7" height="7" rx="1" fill="#7c3aed" fillOpacity="0.3"/><rect x="2" y="11" width="7" height="7" rx="1" fill="#7c3aed" fillOpacity="0.3"/><rect x="11" y="11" width="7" height="7" rx="1" fill="#7c3aed" fillOpacity="0.6"/></svg>
                </div>
                <p className="text-[13px] text-[#4a5568]">Select a project to preview</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="w-72 flex-shrink-0 bg-[#16213e] border-l border-[#0f3460]/60 flex flex-col">

        {/* Element Inspector */}
        <div className="p-3.5 border-b border-[#0f3460]/60">
          <div className="text-[10px] font-semibold text-[#4a5568] uppercase tracking-widest mb-2.5">Selected Element</div>
          {selectedElement ? (
            <div className="bg-[#0f1b35] rounded-lg p-3 border border-[#0f3460]/50 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[#7c3aed] font-mono text-xs">&lt;{selectedElement.tag}&gt;</span>
                {selectedElement.id && <span className="text-[10px] text-[#4a5568] font-mono">#{selectedElement.id}</span>}
              </div>
              {selectedElement.classes && (
                <div>
                  <div className="text-[10px] text-[#4a5568] mb-0.5">class</div>
                  <div className="text-[11px] text-[#718096] font-mono break-all leading-relaxed">
                    {selectedElement.classes.replace('canvas-hover','').replace('canvas-selected','').trim().slice(0,80)}
                  </div>
                </div>
              )}
              {selectedElement.text && (
                <div>
                  <div className="text-[10px] text-[#4a5568] mb-0.5">content</div>
                  <div className="text-[12px] text-[#e2e8f0] leading-relaxed">"{selectedElement.text.slice(0,100)}"</div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-[#0f1b35] rounded-lg p-3 border border-dashed border-[#0f3460]/50">
              <p className="text-[11px] text-[#4a5568] text-center">Click any element in the preview</p>
            </div>
          )}
        </div>

        {/* Chat */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-3.5 pt-3 pb-1">
            <div className="text-[10px] font-semibold text-[#4a5568] uppercase tracking-widest">Instructions</div>
          </div>

          <div className="flex-1 overflow-y-auto px-3.5 pb-2 space-y-2.5">
            {messages.length === 0 && !sending && (
              <div className="text-[11px] text-[#4a5568] italic leading-relaxed">
                Select an element, then describe what you want changed.
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={`max-w-[92%] text-[11.5px] rounded-xl px-3 py-2 leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-[#7c3aed] text-white rounded-tr-sm'
                    : 'bg-[#0f1b35] text-[#a0aec0] border border-[#0f3460]/50 rounded-tl-sm'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}

            {/* Progress indicator */}
            {sending && progress.length > 0 && (
              <div className="bg-[#0f1b35] border border-[#0f3460]/50 rounded-xl p-3 space-y-1.5">
                {progress.map((step, i) => (
                  <div key={i} className={`flex items-center gap-2.5 text-[11px] transition-all duration-300 ${
                    step.state === 'active' ? 'text-[#a78bfa]' :
                    step.state === 'done' ? 'text-[#4a5568] line-through' :
                    step.state === 'error' ? 'text-red-400' :
                    'text-[#2d3748]'
                  }`}>
                    <span className="flex-shrink-0 w-3.5 flex items-center justify-center">
                      {step.state === 'done' && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#4a5568" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      {step.state === 'active' && (
                        <span className="w-2 h-2 rounded-full bg-[#7c3aed] animate-pulse block"></span>
                      )}
                      {step.state === 'pending' && <span className="w-1.5 h-1.5 rounded-full bg-[#2d3748] block mx-auto"></span>}
                      {step.state === 'error' && <span className="text-red-400 text-xs">✕</span>}
                    </span>
                    <span>{step.label}</span>
                    {step.state === 'active' && (
                      <span className="ml-auto flex gap-0.5">
                        {[0,1,2].map(j => (
                          <span key={j} className="w-1 h-1 rounded-full bg-[#7c3aed]" style={{animation: `bounce 0.8s ${j*0.15}s ease-in-out infinite alternate`}}></span>
                        ))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3.5 border-t border-[#0f3460]/60">
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder={selectedRepo ? (selectedElement ? `Change the selected ${selectedElement.tag} to...` : "Select an element first") : "Select a project"}
              disabled={!selectedRepo || sending}
              rows={3}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendEdit() } }}
              className="w-full bg-[#0f1b35] border border-[#0f3460]/50 rounded-lg px-3 py-2.5 text-[12px] text-[#e2e8f0] placeholder-[#4a5568] outline-none focus:border-[#7c3aed]/60 resize-none transition-colors disabled:opacity-40 font-sans"
            />
            <div className="mt-2 flex gap-2">
              {undoData && (
                <button
                  onClick={handleUndo}
                  disabled={undoing || sending}
                  title={`Undo: ${undoData.description}`}
                  className="flex-shrink-0 bg-[#0f1b35] border border-[#0f3460]/60 hover:border-[#7c3aed]/40 disabled:opacity-40 disabled:cursor-not-allowed text-[#718096] hover:text-[#a78bfa] font-medium rounded-lg px-3 py-2 text-[11px] transition-all flex items-center gap-1.5 whitespace-nowrap"
                >
                  {undoing ? <span className="w-3 h-3 rounded-full border-2 border-[#718096]/30 border-t-[#718096] animate-spin"></span> : '↩'}
                  Undo
                </button>
              )}
              <button
                onClick={sendEdit}
                disabled={!selectedRepo || !instruction.trim() || sending}
                className="flex-1 bg-gradient-to-r from-[#7c3aed] to-[#4f46e5] hover:from-[#6d28d9] hover:to-[#4338ca] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-2 text-[12px] transition-all flex items-center justify-center gap-2"
              >
                {sending ? (
                  <><span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin"></span>Working...</>
                ) : (
                  <>Send ↵</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          from { transform: translateY(0); }
          to { transform: translateY(-3px); }
        }
      `}</style>
    </div>
  )
}
