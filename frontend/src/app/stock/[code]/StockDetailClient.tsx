'use client'

import useSWR from 'swr'
import { ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Users, BarChart2, DollarSign, Building2 } from 'lucide-react'
import Link from 'next/link'
import { HolderHeatmap } from '@/components/HolderHeatmap'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())

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
  stock_name: string
  market: string
  industry: string
  big_holder_trend: number
  mid_holder_trend: number
  small_holder_trend: number
  total_holders: number
  latest_ratio: number
  price?: { close: number; change: number; change_pct: number } | null
  week_dates: string[]
  weekly_ratios: Array<{ date: string; big: number; mid: number; small: number }>
}

interface StockDetailClientProps {
  code: string
}

function formatDate(d: string): string {
  if (!d) return ''
  if (d.length === 8) return d.slice(0,4) + '/' + d.slice(4,6) + '/' + d.slice(6,8)
  return d
}

function TrendBadge({ value, label }: { value: number; label: string }) {
  const isPos = value > 0
  const isNeg = value < 0
  const colorClass = isPos ? 'text-red-600 bg-red-50 border-red-200' : isNeg ? 'text-green-600 bg-green-50 border-green-200' : 'text-slate-600 bg-slate-50 border-slate-200'
  const arrow = isPos ? '▲' : isNeg ? '▼' : '─'
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs text-slate-500 mb-2">{label}</div>
      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-sm font-bold ${colorClass}`}>
        <span>{arrow}</span>
        <span>{isPos ? '+' : ''}{value.toFixed(2)}%</span>
      </div>
    </div>
  )
}

export function StockDetailClient({ code }: StockDetailClientProps) {
  const { data: dist, error: distError, isLoading: distLoading } = useSWR<DistributionResponse>(
    `${API_BASE}/api/distribution/${code}`,
    fetcher, { revalidateOnFocus: false }
  )

  const { data: summary, isLoading: summaryLoading } = useSWR<StockSummary>(
    `${API_BASE}/api/stock/${code}`,
    fetcher, { revalidateOnFocus: false }
  )

  const isLoading = distLoading || summaryLoading

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-center py-24 text-slate-400 text-sm">
          <span className="animate-spin mr-2 text-xl">⟳</span>載入中...
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

  const stockName = summary?.stock_name || dist.stock_name || ''
  const latestDate = dist.data?.[0]?.date || ''

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mt-1">
          <ArrowLeft className="w-4 h-4" /> 返回
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-800">
              <span className="font-mono">{dist.stock_code}</span>
              {stockName && <span className="ml-2 text-lg font-normal text-slate-600">{stockName}</span>}
            </h1>
            {summary?.industry && (
              <span className="text-xs px-2 py-1 rounded-full bg-primary-50 text-primary-700 border border-primary-200">{summary.industry}</span>
            )}
            {summary?.market && (
              <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">{summary.market === 'twse' ? '上市' : summary.market === 'tpex' ? '上櫃' : summary.market}</span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">最新資料：{formatDate(latestDate)} · 共 {dist.weeks_count} 週</p>
        </div>
        {/* Price box */}
        {summary?.price && (
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 text-right min-w-[120px]">
            <div className="text-2xl font-bold text-slate-800">{summary.price.close.toFixed(2)}</div>
            <div className={`text-sm font-medium ${summary.price.change > 0 ? 'text-red-600' : summary.price.change < 0 ? 'text-green-600' : 'text-slate-500'}`}>
              {summary.price.change > 0 ? '+' : ''}{summary.price.change.toFixed(2)} ({summary.price.change > 0 ? '+' : ''}{summary.price.change_pct.toFixed(2)}%)
            </div>
            <div className="text-xs text-slate-400 mt-0.5">收盤價</div>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <TrendBadge value={summary.big_holder_trend} label="大股東週增減" />
          <TrendBadge value={summary.mid_holder_trend} label="中股東週增減" />
          <TrendBadge value={summary.small_holder_trend} label="小股東週增減" />
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs text-slate-500">總股東人數</span>
            </div>
            <div className="text-lg font-bold text-slate-800">{summary.total_holders.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Big Holder Ratio Trend */}
      {summary && summary.weekly_ratios && summary.weekly_ratios.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-primary-500" />
            大股東持有比率週變化
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 text-slate-600 font-medium">日期</th>
                  <th className="text-center px-3 py-2 text-slate-600 font-medium">大股東%</th>
                  <th className="text-center px-3 py-2 text-slate-600 font-medium">中股東%</th>
                  <th className="text-center px-3 py-2 text-slate-600 font-medium">小股東%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...summary.weekly_ratios].reverse().map((r, i, arr) => {
                  const prev = arr[i + 1]
                  const bigDiff = prev ? Math.round((r.big - prev.big) * 100) / 100 : null
                  return (
                    <tr key={r.date} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-600 font-medium">{formatDate(r.date)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className="font-bold text-slate-800">{r.big.toFixed(2)}%</span>
                        {bigDiff !== null && bigDiff !== 0 && (
                          <span className={`ml-1.5 text-xs ${bigDiff > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            ({bigDiff > 0 ? '+' : ''}{bigDiff.toFixed(2)})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center text-slate-600">{r.mid.toFixed(2)}%</td>
                      <td className="px-3 py-2 text-center text-slate-600">{r.small.toFixed(2)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Holder Distribution Heatmap */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-1.5">
          <BarChart2 className="w-4 h-4 text-primary-500" />
          持股分布趨勢（各級距持股比率）
        </h2>
        <HolderHeatmap
          data={dist.data}
          stockCode={dist.stock_code}
          stockName={stockName}
        />
      </div>
    </div>
  )
}
