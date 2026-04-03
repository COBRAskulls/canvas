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
}

interface UndoData {
  repo: string
  commitBefore: string
  description: string
}

type Status = 'idle' | 'working' | 'polling' | 'live'

export default function Editor() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(true)
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
  const [search, setSearch] = useState('')
  const [pages, setPages] = useState<string[]>([])
  const [selectedPage, setSelectedPage] = useState<string>('/')
  const [previewMode, setPreviewMode] = useState<'live' | 'source'>('live')
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null)
  const [instruction, setInstruction] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [statusText, setStatusText] = useState('')
  const [undoData, setUndoData] = useState<UndoData | null>(null)
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
  }, [messages])

  // Persist per-repo messages
  useEffect(() => {
    if (!selectedRepo || messages.length === 0) return
    try { localStorage.setItem(`canvas_msgs_${selectedRepo.name}`, JSON.stringify(messages.slice(-100))) } catch {}
  }, [messages, selectedRepo])

  const filteredRepos = repos.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))

  function loadRepo(repo: Repo) {
    setSelectedRepo(repo)
    setSelectedElement(null)
    setStatus('idle')
    setStatusText('')
    setPages([])
    setSelectedPage('/')
    setPreviewMode('live')
    try {
      const saved = JSON.parse(localStorage.getItem(`canvas_msgs_${repo.name}`) || '[]')
      setMessages(saved)
    } catch { setMessages([]) }
    // Fetch pages for this repo
    fetch(`/api/pages?repo=${encodeURIComponent(repo.name)}`)
      .then(r => r.json())
      .then(d => { if (d.pages) setPages(d.pages) })
      .catch(() => {})
  }

  function getIframeSrc(repo: Repo, page: string, mode: 'live' | 'source'): string {
    if (mode === 'source') {
      return `/api/source-preview?repo=${encodeURIComponent(repo.name)}&route=${encodeURIComponent(page)}`
    }
    if (!repo.liveUrl) return ''
    const base = repo.liveUrl.replace(/\/$/, '')
    const url = page === '/' ? base : `${base}${page}`
    return `/api/proxy?url=${encodeURIComponent(url)}`
  }

  function navigateToPage(page: string) {
    setSelectedPage(page)
    setSelectedElement(null)
    if (iframeRef.current && selectedRepo) {
      iframeRef.current.src = getIframeSrc(selectedRepo, page, previewMode)
    }
  }

  function switchPreviewMode(mode: 'live' | 'source') {
    setPreviewMode(mode)
    setSelectedElement(null)
    if (iframeRef.current && selectedRepo) {
      iframeRef.current.src = getIframeSrc(selectedRepo, selectedPage, mode)
    }
  }

  async function getLatestCommit(repo: string): Promise<string> {
    try {
      const r = await fetch(`/api/deploy-status?repo=${repo}`)
      const d = await r.json()
      return d.latestCommit || ''
    } catch { return '' }
  }

  async function pollForCommit(repo: string, expectedCommit: string, startTime: number) {
    const maxWait = 3 * 60 * 1000 // 3 min
    if (Date.now() - startTime > maxWait) {
      setStatus('idle')
      setStatusText('')
      return
    }

    const r = await fetch(`/api/deploy-status?repo=${repo}&commit=${expectedCommit}`)
    const d = await r.json()

    if (d.found) {
      setStatus('polling')
      setStatusText('Commit pushed · deploying...')
      // Wait 35 seconds for Vercel to auto-deploy
      setTimeout(() => {
        setStatus('live')
        setStatusText('Live ✓')
        if (iframeRef.current && selectedRepo) {
          // Append cache buster only for live mode
          const src = getIframeSrc(selectedRepo, selectedPage, previewMode)
          iframeRef.current.src = previewMode === 'live' ? src + (src.includes('?') ? '&' : '?') + 'v=' + Date.now() : src
        }
        setTimeout(() => { setStatus('idle'); setStatusText('') }, 5000)
      }, 35000)
    } else {
      setTimeout(() => pollForCommit(repo, expectedCommit, startTime), 5000)
    }
  }

  async function sendEdit() {
    if (!instruction.trim() || !selectedRepo || status === 'working') return

    const userMsg: Message = { role: 'user', content: instruction, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    const savedInstruction = instruction
    setInstruction('')
    setStatus('working')
    setStatusText('Rosie is working...')

    // Get current commit SHA before edit (for undo)
    const commitBefore = await getLatestCommit(selectedRepo.name)

    try {
      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: selectedRepo.name,
          element: selectedElement,
          instruction: savedInstruction,
        })
      })
      const data = await res.json()

      if (data.success) {
        const reply = `✅ ${data.description}\n\`${data.file}\` · commit \`${data.commit}\``
        setMessages(prev => [...prev, { role: 'rosie', content: reply, ts: Date.now() }])

        // Store undo context
        if (commitBefore) setUndoData({ repo: selectedRepo.name, commitBefore, description: data.description })

        // Reload pages list in case new pages were added
        fetch(`/api/pages?repo=${encodeURIComponent(selectedRepo.name)}`)
          .then(r => r.json())
          .then(d => { if (d.pages) setPages(d.pages) })
          .catch(() => {})

        // Poll GitHub for the commit
        setStatus('polling')
        setStatusText('Waiting for GitHub...')
        pollForCommit(selectedRepo.name, data.commit, Date.now())
      } else {
        const reply = data.rosieReply
          ? `Rosie responded:\n${data.rosieReply}`
          : `❌ ${data.error || 'Edit failed'}`
        setMessages(prev => [...prev, { role: 'rosie', content: reply, ts: Date.now() }])
        setStatus('idle')
        setStatusText('')
      }
    } catch {
      setMessages(prev => [...prev, { role: 'rosie', content: '❌ Connection error.', ts: Date.now() }])
      setStatus('idle')
      setStatusText('')
    }
  }

  async function handleUndo() {
    if (!undoData || undoing) return
    setUndoing(true)
    setMessages(prev => [...prev, { role: 'user', content: `↩ Undo: ${undoData.description}`, ts: Date.now() }])

    try {
      const res = await fetch('/api/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(undoData)
      })
      const data = await res.json()
      if (data.success) {
        setMessages(prev => [...prev, { role: 'rosie', content: `↩️ Reverted · \`${data.commit}\``, ts: Date.now() }])
        setUndoData(null)
        setStatus('polling')
        setStatusText('Deploying revert...')
        pollForCommit(undoData.repo, data.commit, Date.now())
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
            {selectedRepo && (
              <button onClick={() => { setMessages([]); if (selectedRepo) localStorage.removeItem(`canvas_msgs_${selectedRepo.name}`) }}
                className="text-[10px] text-[#4a5568] hover:text-[#718096] transition-colors">Clear</button>
            )}
            <button onClick={signOut} className="text-[10px] text-[#4a5568] hover:text-[#a0aec0] transition-colors">Sign out</button>
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
            <button key={repo.id} onClick={() => loadRepo(repo)}
              className={`w-full text-left px-2.5 py-2 rounded-md transition-all ${
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
        <div className="h-9 bg-[#16213e] border-b border-[#0f3460]/60 flex items-center px-4 gap-2">
          <div className="flex gap-1.5 flex-shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/70"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/70"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/70"></div>
          </div>

          {/* Refresh button */}
          <button
            onClick={() => {
              if (iframeRef.current && selectedRepo) {
                const src = getIframeSrc(selectedRepo, selectedPage, previewMode)
                iframeRef.current.src = previewMode === 'live' ? src + (src.includes('?') ? '&' : '?') + 'v=' + Date.now() : src
              }
            }}
            disabled={!selectedRepo}
            title="Refresh preview"
            className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-[#4a5568] hover:text-[#a0aec0] hover:bg-[#0f3460]/40 disabled:opacity-30 transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M13.65 2.35A8 8 0 1 0 15 8h-2a6 6 0 1 1-1.05-3.35L9 7h6V1l-1.35 1.35z" fill="currentColor"/>
            </svg>
          </button>

          {/* URL bar */}
          <div className="flex-1 bg-[#0f1b35] border border-[#0f3460]/50 rounded px-2.5 py-0.5 text-[11px] text-[#4a5568] font-mono truncate">
            {selectedRepo
              ? previewMode === 'source'
                ? `source: ${selectedRepo.name}${selectedPage}`
                : selectedRepo.liveUrl
                  ? `${selectedRepo.liveUrl.replace(/\/$/, '')}${selectedPage === '/' ? '' : selectedPage}`
                  : 'no live URL'
              : 'select a project'}
          </div>

          {/* Live / Source toggle */}
          {selectedRepo && (
            <div className="flex-shrink-0 flex items-center bg-[#0f1b35] border border-[#0f3460]/50 rounded overflow-hidden">
              <button
                onClick={() => switchPreviewMode('live')}
                className={`px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  previewMode === 'live'
                    ? 'bg-[#7c3aed]/30 text-[#a78bfa]'
                    : 'text-[#4a5568] hover:text-[#718096]'
                }`}
              >Live</button>
              <button
                onClick={() => switchPreviewMode('source')}
                className={`px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  previewMode === 'source'
                    ? 'bg-[#7c3aed]/30 text-[#a78bfa]'
                    : 'text-[#4a5568] hover:text-[#718096]'
                }`}
              >Source</button>
            </div>
          )}

          {/* Page selector */}
          {pages.length > 1 && (
            <select
              value={selectedPage}
              onChange={e => navigateToPage(e.target.value)}
              className="flex-shrink-0 bg-[#0f1b35] border border-[#0f3460]/50 rounded px-2 py-0.5 text-[11px] text-[#a0aec0] font-mono outline-none focus:border-[#7c3aed]/60 transition-colors max-w-[140px] cursor-pointer"
            >
              {pages.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}

          {status !== 'idle' && (
            <div className={`flex-shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded ${
              status === 'live' ? 'text-emerald-400 bg-emerald-400/10' :
              status === 'working' ? 'text-violet-400 bg-violet-400/10' :
              'text-amber-400 bg-amber-400/10'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                status === 'live' ? 'bg-emerald-400' :
                status === 'working' ? 'bg-violet-400 animate-pulse' :
                'bg-amber-400 animate-pulse'
              }`}></span>
              <span className="whitespace-nowrap">{statusText}</span>
            </div>
          )}
        </div>

        <div className="flex-1 relative bg-[#1a1a2e]">
          {selectedRepo ? (
            previewMode === 'source' || selectedRepo.liveUrl ? (
              <iframe
                ref={iframeRef}
                src={getIframeSrc(selectedRepo, selectedPage, previewMode)}
                className="w-full h-full border-0"
                title="Preview"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-3 max-w-xs px-6">
                  <div className="text-3xl">🔗</div>
                  <p className="text-[13px] text-[#718096] font-medium">No live URL for this repo</p>
                  <p className="text-[11px] text-[#4a5568]">Switch to Source mode to browse and edit the code directly.</p>
                  <button
                    onClick={() => switchPreviewMode('source')}
                    className="mt-2 px-4 py-2 bg-[#7c3aed]/20 hover:bg-[#7c3aed]/30 border border-[#7c3aed]/30 rounded-lg text-[12px] text-[#a78bfa] font-medium transition-colors"
                  >
                    Switch to Source mode
                  </button>
                </div>
              </div>
            )
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
            <div className="bg-[#0f1b35] rounded-lg p-3 border border-[#0f3460]/50 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[#7c3aed] font-mono text-xs">&lt;{selectedElement.tag}&gt;</span>
                {selectedElement.id && <span className="text-[10px] text-[#4a5568] font-mono">#{selectedElement.id}</span>}
              </div>
              {selectedElement.classes && (
                <div className="text-[11px] text-[#718096] font-mono break-all leading-relaxed">
                  {selectedElement.classes.replace('canvas-hover', '').replace('canvas-selected', '').trim().slice(0, 80)}
                </div>
              )}
              {selectedElement.text && (
                <div className="text-[12px] text-[#e2e8f0] leading-relaxed border-t border-[#0f3460]/40 pt-2">
                  "{selectedElement.text.slice(0, 120)}"
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
            {messages.length === 0 && (
              <div className="text-[11px] text-[#4a5568] italic leading-relaxed">
                Click an element to target it, or just describe what you want changed — element selection is optional.
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={`max-w-[92%] text-[11.5px] rounded-xl px-3 py-2 leading-relaxed whitespace-pre-wrap font-mono ${
                  m.role === 'user'
                    ? 'bg-[#7c3aed] text-white rounded-tr-sm'
                    : 'bg-[#0f1b35] text-[#a0aec0] border border-[#0f3460]/50 rounded-tl-sm'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}

            {status === 'working' && (
              <div className="flex items-center gap-2 text-[11px] text-[#7c3aed]">
                <span className="w-3 h-3 rounded-full border-2 border-[#7c3aed]/30 border-t-[#7c3aed] animate-spin flex-shrink-0"></span>
                Rosie is working...
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="p-3.5 border-t border-[#0f3460]/60 space-y-2.5">

            {/* Undo bar — always visible when undo is available */}
            {undoData && (
              <div className="flex items-center gap-2 bg-[#1e1040] border border-[#7c3aed]/25 rounded-lg px-3 py-2">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 text-[#a78bfa]">
                  <path d="M1.5 3.5L4 1v2.5H10a5.5 5.5 0 0 1 0 11H5v-2h5a3.5 3.5 0 0 0 0-7H4V8L1.5 5.5l2.5-2z" fill="currentColor"/>
                </svg>
                <span className="flex-1 text-[11px] text-[#a78bfa] truncate">{undoData.description}</span>
                <button
                  onClick={handleUndo}
                  disabled={undoing || status === 'working'}
                  className="flex-shrink-0 text-[11px] font-semibold text-[#7c3aed] hover:text-white bg-[#7c3aed]/15 hover:bg-[#7c3aed]/30 border border-[#7c3aed]/30 hover:border-[#7c3aed]/60 rounded-md px-2.5 py-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {undoing
                    ? <span className="w-2.5 h-2.5 rounded-full border-2 border-[#7c3aed]/30 border-t-[#7c3aed] animate-spin"></span>
                    : null
                  }
                  Undo
                </button>
              </div>
            )}

            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder={selectedRepo
                ? (selectedElement
                    ? `Change the selected ${selectedElement.tag}...`
                    : 'Describe what to change — click an element or just type what you need...')
                : 'Select a project'}
              disabled={!selectedRepo || status === 'working'}
              rows={3}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendEdit() } }}
              className="w-full bg-[#0f1b35] border border-[#0f3460]/50 rounded-lg px-3 py-2.5 text-[12px] text-[#e2e8f0] placeholder-[#4a5568] outline-none focus:border-[#7c3aed]/60 resize-none transition-colors disabled:opacity-40 font-sans"
            />

            <button
              onClick={sendEdit}
              disabled={!selectedRepo || !instruction.trim() || status === 'working'}
              className="w-full bg-gradient-to-r from-[#7c3aed] to-[#4f46e5] hover:from-[#6d28d9] hover:to-[#4338ca] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-2.5 text-[12px] transition-all flex items-center justify-center gap-2"
            >
              {status === 'working' ? (
                <><span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin"></span>Working...</>
              ) : 'Send ↵'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
