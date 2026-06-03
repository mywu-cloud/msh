'use client'

import { use } from 'react'
import useSWR from 'swr'
import { ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Users, BarChart2 } from 'lucide-react'
import Link from 'next/link'
import { HolderHeatmap } from '@/components/HolderHeatmap'
import { ChangeTag } from '@/components/ChangeTag'
import { ScoreBar } from '@/components/ScoreBar'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())

// Required for Next.js static export
export function generateStaticParams() {
  return []
}

interface DistributionResponse {
  stock_code: string
  stock_name: string
  weeks_count: number
  latest_date: string
  data: WeekData[]
}

interface WeekData {
  date: string
  brackets: BracketRow[]
}

interface BracketRow {
  date: string
  bracket: string
  ratio: number
  holders: number
  shares: number
}

interface StockSummary {
  stock_code: string
  stock_name?: string
  market?: string
  big_holder_trend: number
  mid_holder_trend?: number
  small_holder_trend?: number
  latest_week_change?: number
  score?: number
  total_holders?: number
}

interface PageProps {
  params: Promise<{ code: string }>
}

export default function StockDetailPage({ params }: PageProps) {
  const { code } = use(params)

  const { data: dist, error: distError, isLoading: distLoading } = useSWR<DistributionResponse>(
    `${API_BASE}/api/distribution/${code}`,
    fetcher
  )

  const { data: summary, isLoading: summaryLoading } = useSWR<StockSummary>(
    `${API_BASE}/api/stock/${code}`,
    fetcher
  )

  const isLoading = distLoading || summaryLoading

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-center py-24 text-slate-400 text-sm">
          <span className="animate-spin mr-2">⟳</span>載入中...
        </div>
      </div>
    )
  }

  if (distError || !dist) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4">
          <ArrowLeft className="w-4 h-4" /> 返回首頁
        </Link>
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 text-sm gap-2">
          <AlertTriangle className="w-6 h-6" />
          <span>找不到股票 {code} 的資料</span>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-4 h-4" /> 返回
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-800">
            {dist.stock_code}
            {dist.stock_name && <span className="ml-2 text-base font-normal text-slate-500">{dist.stock_name}</span>}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">最新資料：{dist.latest_date} · 共 {dist.weeks_count} 週</p>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-500">大股東趨勢</span>
            </div>
            <ChangeTag value={summary.big_holder_trend} />
          </div>
          {summary.mid_holder_trend !== undefined && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <BarChart2 className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-500">中股東趨勢</span>
              </div>
              <ChangeTag value={summary.mid_holder_trend} />
            </div>
          )}
          {summary.small_holder_trend !== undefined && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-500">小股東趨勢</span>
              </div>
              <ChangeTag value={summary.small_holder_trend} />
            </div>
          )}
          {summary.total_holders !== undefined && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-500">總股東人數</span>
              </div>
              <span className="text-lg font-bold text-slate-800">
                {summary.total_holders.toLocaleString()}
              </span>
            </div>
          )}
          {summary.score !== undefined && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 col-span-2 sm:col-span-1">
              <div className="flex items-center gap-2 mb-2">
                <BarChart2 className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-500">強度分數</span>
              </div>
              <ScoreBar score={summary.score} />
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">持股分布趨勢</h2>
        <HolderHeatmap
          data={dist.data}
          stockCode={dist.stock_code}
          stockName={dist.stock_name}
        />
      </div>
    </div>
  )
}
