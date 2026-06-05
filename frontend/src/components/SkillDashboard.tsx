'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { TrendingUp, AlertTriangle, Users, BarChart2 } from 'lucide-react'
import { ScoreBar } from './ScoreBar'
import { ChangeTag } from './ChangeTag'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Candidate {
  stock_code: string
  stock_name: string
  market: string | null
  skill_score: number
  big_holder_ratio: number
  latest_week_change: number
  holder_change: number
  alert: boolean
}

interface Props {
  market: 'all' | 'twse' | 'tpex'
  searchQuery: string
}

function MarketBadge({ market }: { market: string | null }) {
  if (market === 'twse') return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">上市</span>
  )
  if (market === 'tpex') return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-green-50 text-green-600">上櫃</span>
  )
  return null
}

export function SkillDashboard({ market, searchQuery }: Props) {
  const { data, error, isLoading } = useSWR(
    `${API_BASE}/api/skill-analysis?market=${market}&limit=40`,
    fetcher,
    { refreshInterval: 3600000 }
  )

  if (isLoading) return (
    <div className="p-8 text-center text-slate-400">
      <div className="animate-spin w-8 h-8 border-2 border-primary-300 border-t-primary-600 rounded-full mx-auto mb-4" />
      <p>載入籌碼分析中...</p>
    </div>
  )

  if (error || !data) return (
    <div className="p-8 text-center text-slate-400">
      <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="font-medium">暫無資料</p>
      <p className="text-sm mt-1">請確認 API 服務正常，或等待週六資料更新</p>
    </div>
  )

  const candidates: Candidate[] = Array.isArray(data) ? data : (data.data || data.candidates || [])
  const filtered = candidates.filter(c =>
    !searchQuery || c.stock_code.includes(searchQuery) || (c.stock_name || '').includes(searchQuery)
  )

  if (filtered.length === 0) return (
    <div className="p-8 text-center text-slate-400"><p>找不到符合條件的股票</p></div>
  )

  return (
    <div className="divide-y divide-surface-border">
      {filtered.map((c, idx) => (
        <Link key={c.stock_code} href={`/stock/${c.stock_code}`}
          className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors"
        >
          <div className="w-6 text-sm text-slate-400 font-mono text-center">{idx + 1}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold text-slate-800">{c.stock_code}</span>
              <span className="text-sm text-slate-600 truncate">{c.stock_name}</span>
              {market === 'all' && <MarketBadge market={c.market} />}
              {c.alert && (
                <span className="flex items-center gap-0.5 text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                  <AlertTriangle className="w-3 h-3" />暴增
                </span>
              )}
            </div>
            <div className="mt-1"><ScoreBar score={c.skill_score} /></div>
          </div>
          <div className="hidden sm:flex items-center gap-6 text-sm text-slate-500">
            <div className="text-center">
              <div className="flex items-center gap-1 text-xs text-slate-400 mb-0.5">
                <TrendingUp className="w-3 h-3" />大股東
              </div>
              <span className="font-medium text-slate-700">{(c.big_holder_ratio || 0).toFixed(1)}%</span>
              <ChangeTag value={c.latest_week_change} suffix="%" />
            </div>
            <div className="text-center">
              <div className="flex items-center gap-1 text-xs text-slate-400 mb-0.5">
                <Users className="w-3 h-3" />股東數
              </div>
              <ChangeTag value={c.holder_change} />
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-primary-600">{c.skill_score.toFixed(0)}</div>
            <div className="text-xs text-slate-400">分</div>
          </div>
        </Link>
      ))}
    </div>
  )
  }
