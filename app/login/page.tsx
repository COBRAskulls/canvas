'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('john@cobraspeer.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1a1a2e]">
      <div className="w-full max-w-sm px-4">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#7c3aed]/30">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="7" height="7" rx="1" fill="white" fillOpacity="0.9"/>
              <rect x="11" y="2" width="7" height="7" rx="1" fill="white" fillOpacity="0.5"/>
              <rect x="2" y="11" width="7" height="7" rx="1" fill="white" fillOpacity="0.5"/>
              <rect x="11" y="11" width="7" height="7" rx="1" fill="white" fillOpacity="0.9"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">Canvas</h1>
          <p className="text-sm text-[#4a5568] mt-1">Visual site editor</p>
        </div>

        <form onSubmit={handleLogin} className="bg-[#16213e] border border-[#0f3460]/60 rounded-2xl p-6 space-y-4 shadow-xl">
          {error && (
            <div className="text-red-400 text-xs bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">{error}</div>
          )}
          <div>
            <label className="text-[10px] font-semibold text-[#4a5568] uppercase tracking-widest block mb-1.5">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-[#0f1b35] border border-[#0f3460]/50 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#7c3aed]/60 transition-colors" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-[#4a5568] uppercase tracking-widest block mb-1.5">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
              className="w-full bg-[#0f1b35] border border-[#0f3460]/50 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#7c3aed]/60 transition-colors"
              onKeyDown={e => { if (e.key === 'Enter') handleLogin(e as any) }} />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-gradient-to-r from-[#7c3aed] to-[#4f46e5] hover:from-[#6d28d9] hover:to-[#4338ca] text-white font-semibold rounded-lg py-2.5 text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? (
              <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin"></span>Signing in...</>
            ) : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
