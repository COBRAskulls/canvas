'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
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

type DeployState = 'idle' | 'waiting' | 'building' | 'live'

export default function Editor() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(true)
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
  const [search, setSearch] = useState('')
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null)
  const [instruction, setInstruction] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [sending, setSending] = useState(false)
  const [deployState, setDeployState] = useState<DeployState>('idle')
  const [deployUrl, setDeployUrl] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const router = useRouter()
  const supabase = createClient()

  // Load repos
  useEffect(() => {
    fetch('/api/repos')
      .then(r => r.json())
      .then(data => { setRepos(data); setLoadingRepos(false) })
      .catch(() => setLoadingRepos(false))
  }, [])

  // Listen for element selections from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'ELEMENT_SELECTED') {
        setSelectedElement(e.data.element)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const filteredRepos = repos.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase())
  )

  async function sendToRosie() {
    if (!instruction.trim() || !selectedRepo) return
    setSending(true)
    setDeployState('idle')

    const elementContext = selectedElement
      ? `element <${selectedElement.tag}> with classes "${selectedElement.classes}" and text "${selectedElement.text.slice(0, 100)}"`
      : 'the relevant element'

    const message = `In the ${selectedRepo.name} project, find the ${elementContext} and ${instruction}. Push the change to GitHub when done.`

    const userMsg: Message = { role: 'user', content: instruction, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInstruction('')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      })
      const data = await res.json()
      const reply = data.reply || data.error || 'No response.'
      setMessages(prev => [...prev, { role: 'rosie', content: reply, ts: Date.now() }])

      // Start polling deploy status
      if (selectedRepo.vercelProjectId) {
        setDeployState('waiting')
        pollDeploy(selectedRepo.vercelProjectId, Date.now())
      }
    } catch {
      setMessages(prev => [...prev, { role: 'rosie', content: 'Connection error. Try again.', ts: Date.now() }])
    } finally {
      setSending(false)
    }
  }

  async function pollDeploy(projectId: string, startTime: number) {
    const maxTime = 5 * 60 * 1000 // 5 min
    if (Date.now() - startTime > maxTime) { setDeployState('idle'); return }

    const res = await fetch(`/api/deploy-status?projectId=${projectId}`)
    const data = await res.json()

    if (data.state === 'READY') {
      setDeployState('live')
      setDeployUrl(data.url)
      // Refresh iframe
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

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex h-screen bg-[#0a0a0a] overflow-hidden">

      {/* LEFT SIDEBAR */}
      <div className="w-64 flex-shrink-0 bg-[#111] border-r border-[#1e1e1e] flex flex-col">
        <div className="p-4 border-b border-[#1e1e1e] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#c9a84c] flex items-center justify-center text-black font-bold text-xs">C</div>
            <span className="text-white font-semibold text-sm">Canvas</span>
          </div>
          <button onClick={signOut} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Sign out</button>
        </div>

        <div className="p-3">
          <input
            type="text"
            placeholder="Search repos..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-[#c9a84c]/50 transition-colors"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {loadingRepos ? (
            <div className="text-xs text-gray-600 px-2 py-3">Loading repos...</div>
          ) : (
            filteredRepos.map(repo => (
              <button
                key={repo.id}
                onClick={() => { setSelectedRepo(repo); setSelectedElement(null); setMessages([]) }}
                className={`w-full text-left px-3 py-2.5 rounded-lg mb-0.5 transition-all ${
                  selectedRepo?.id === repo.id
                    ? 'bg-[#c9a84c]/15 border border-[#c9a84c]/30 text-[#c9a84c]'
                    : 'hover:bg-[#1a1a1a] text-gray-300 border border-transparent'
                }`}
              >
                <div className="text-sm font-medium truncate">{repo.name}</div>
                {repo.liveUrl && (
                  <div className="text-xs text-gray-600 truncate mt-0.5">{repo.liveUrl.replace('https://', '')}</div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* CENTER — IFRAME PREVIEW */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-10 bg-[#111] border-b border-[#1e1e1e] flex items-center px-4 gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57]"></div>
            <div className="w-3 h-3 rounded-full bg-[#febc2e]"></div>
            <div className="w-3 h-3 rounded-full bg-[#28c840]"></div>
          </div>
          <div className="flex-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded-md px-3 py-1 text-xs text-gray-500">
            {selectedRepo?.liveUrl || 'Select a project to preview'}
          </div>
          {deployState !== 'idle' && (
            <div className={`flex items-center gap-1.5 text-xs font-medium ${
              deployState === 'live' ? 'text-green-400' : 'text-yellow-400'
            }`}>
              {deployState === 'live' ? (
                <><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"></span>Live</>
              ) : (
                <><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block animate-pulse"></span>Deploying...</>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 relative bg-[#0a0a0a]">
          {selectedRepo?.liveUrl ? (
            <IframeWithInjection
              ref={iframeRef}
              url={`/api/proxy?url=${encodeURIComponent(selectedRepo.liveUrl)}`}
              onElementSelect={setSelectedElement}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              <div className="text-center">
                <div className="text-3xl mb-3">🖼</div>
                <p>Select a project from the sidebar to preview it</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="w-80 flex-shrink-0 bg-[#111] border-l border-[#1e1e1e] flex flex-col">
        {/* Element Inspector */}
        <div className="p-4 border-b border-[#1e1e1e]">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Selected Element</div>
          {selectedElement ? (
            <div className="bg-[#0a0a0a] rounded-lg p-3 border border-[#2a2a2a] space-y-2">
              <div>
                <span className="text-xs text-gray-600">Tag</span>
                <div className="text-sm text-[#c9a84c] font-mono">&lt;{selectedElement.tag}&gt;</div>
              </div>
              {selectedElement.classes && (
                <div>
                  <span className="text-xs text-gray-600">Classes</span>
                  <div className="text-xs text-gray-400 font-mono break-all">{selectedElement.classes.slice(0, 80)}</div>
                </div>
              )}
              {selectedElement.text && (
                <div>
                  <span className="text-xs text-gray-600">Text</span>
                  <div className="text-sm text-white">{selectedElement.text.slice(0, 100)}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-gray-600 italic">Click any element in the preview</div>
          )}
        </div>

        {/* Rosie Chat */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-4 pt-4 pb-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tell Rosie</div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-3">
            {messages.length === 0 && (
              <div className="text-xs text-gray-600 italic">
                Select an element and tell Rosie what to change.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`${m.role === 'user' ? 'text-right' : ''}`}>
                <div className={`inline-block max-w-[90%] text-xs rounded-xl px-3 py-2 ${
                  m.role === 'user'
                    ? 'bg-[#c9a84c] text-black'
                    : 'bg-[#1a1a1a] text-gray-300 border border-[#2a2a2a]'
                }`}>
                  {m.content}
                </div>
                <div className="text-[10px] text-gray-700 mt-1">
                  {m.role === 'user' ? 'You' : 'Rosie'}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-[#1e1e1e]">
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder={selectedRepo ? "Change the hero headline to..." : "Select a project first"}
              disabled={!selectedRepo || sending}
              rows={3}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendToRosie() } }}
              className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-[#c9a84c]/50 resize-none transition-colors disabled:opacity-40"
            />
            <button
              onClick={sendToRosie}
              disabled={!selectedRepo || !instruction.trim() || sending}
              className="mt-2 w-full bg-[#c9a84c] hover:bg-[#e8c97a] disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold rounded-xl py-2 text-sm transition-colors"
            >
              {sending ? 'Sending...' : 'Send to Rosie ↵'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Iframe with element highlighting injection
// Proxy handles script injection server-side — iframe just renders the proxied URL
const IframeWithInjection = function IframeComp({
  url, onElementSelect, ref
}: {
  url: string
  onElementSelect: (el: SelectedElement) => void
  ref: React.RefObject<HTMLIFrameElement | null>
}) {
  return (
    <iframe
      ref={ref}
      src={url}
      className="w-full h-full border-0"
      title="Site Preview"
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  )
}
