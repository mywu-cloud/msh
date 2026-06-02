'use client'

  import { useMemo } from 'react'
    import useSWR from 'swr'
    import { TrendingUp, TrendingDown, AlertTriangle, ChevronRight } from 'lucide-react'
    import Link from 'next/link'
    import clsx from 'clsx'
    import { ScoreBar } from './ScoreBar'
    import { ChangeTag } from './ChangeTag'

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.workers.dev'

const fetcher = (url: string) => fetch(url).then(r => r.json())

  interface Candidate {
    stock_code: string
        stock_name: string
        market?: string
        industry?: string
        skill_score: number
        big_holder_ratio: number
        big_holder_trend: number
        retail_trend: number
        holder_change: number
        latest_week_change: number
        alert: number | boolean
        analysis_date?: string
      }

      interface Props {
        market: 'all' | 'twse' | 'tpex'
            searchQuery?: string
          }

const MARKET_LABELS: Record<string, string> = {
  twse: '上市',
      tpex: '上櫃',
      all: '全部',
    }

    export function SkillDashboard({ market, searchQuery = '' }: Props) {
  const { data, error, isLoading } = useSWR<{ data: Candidate[]; meta: Record<string, unknown> }>(
    `${API_BASE}/api/skill-analysis?market=${market}&limit=30`,
    fetcher,
{ refreshInterval: 300_000 }
  )

  const filtered = useMemo(() => {
    if (!data?.data) return []
    if (!searchQuery.trim()) return data.data
    const q = searchQuery.toLowerCase()
    return data.data.filter(
      s => s.stock_code.includes(q) || s.stock_name.toLowerCase().includes(q)
    )
}, [data, searchQuery])

  if (isLoading) return <SkeletonTable />
  if (error) return <ErrorState />

  const twseList = filtered.filter(s =>
    /^\d{4}$/.test(s.stock_code) && !s.stock_code.startsWith('0') &&
    parseInt(s.stock_code) < 4000
  )
  const tpexList = filtered.filter(s =>
    /^\d{4}[A-Z]?$/.test(s.stock_code) && parseInt(s.stock_code) >= 4000
  )

  const showSplit = market === 'all'

  return (
    <div>
{showSplit ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-surface-border">
          <MarketSection title="上市起漲潛力" market="twse" data={twseList.slice(0, 20)} />
                <MarketSection title="上櫃起漲潛力" market="tpex" data={tpexList.slice(0, 20)} />
              </div>
            ) : (
              <MarketSection
                title={`${MARKET_LABELS[market]}起漲潛力`}
                market={market as 'twse' | 'tpex'}
          data={filtered.slice(0, 20)}
                      fullWidth
        />
                  )}
    </div>
        )
      }

function MarketSection({
  title,
  market,
  data,
  fullWidth,
}: {
  title: string
      market: 'twse' | 'tpex'
      data: Candidate[]
  fullWidth?: boolean
}) {
  return (
        <div className={clsx('flex flex-col', !fullWidth && 'min-w-0')}>
          <div className="flex items-center justify-between px-6 py-3 bg-surface-secondary border-b border-surface-border">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-up" />
              <span className="font-semibold text-sm text-slate-700">{title}</span>
              <span className="text-xs text-slate-400 bg-white border border-surface-border rounded px-2 py-0.5">
                TOP {data.length}
              </span>
            </div>
            <Link
              href={`/analysis?market=${market}`}
              className="flex items-center gap-1 text-xs text-primary-700 hover:text-primary-600 font-medium"
                        >
                          完整分析 <ChevronRight size={12} />
                        </Link>
                      </div>

                      <div className="table-wrapper">
        <table className="data-table">
                          <thead>
                            <tr>
                              <th className="w-8 text-center">#</th>
                              <th>股票</th>
                              <th className="text-right">Skill分數</th>
                              <th className="text-right">大股東佔比</th>
                              <th className="text-right">本週變化</th>
                              <th className="text-right">股東人數</th>
                              <th className="text-right">累計趨勢</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                {data.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="text-center py-8 text-slate-400 text-sm">
                                  暫無數據
                                </td>
                              </tr>
                            ) : (
                              data.map((s, i) => (
                                <StockRow key={s.stock_code} rank={i + 1} stock={s} />
                              ))
                            )}
          </tbody>
                    </table>
                  </div>
                </div>
              )
            }

            function StockRow({ rank, stock }: { rank: number; stock: Candidate }) {
  const isAlert = Boolean(stock.alert)
  const weekChange = Number(stock.latest_week_change) || 0
  const trend = Number(stock.big_holder_trend) || 0
  const holderChange = Number(stock.holder_change) || 0

  return (
    <tr className={clsx('transition-colors', isAlert && 'bg-alert-light')}>
      <td className="text-center text-slate-400 text-xs w-8">{rank}</td>
      <td>
        <div className="flex items-center gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-800 text-sm">
{stock.stock_code}
              </span>
{isAlert && (
                <span className="surge-badge">
                  <AlertTriangle size={10} />
                  暴增
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
{stock.stock_name}
            </div>
          </div>
        </div>
      </td>
      <td className="text-right">
        <div className="flex flex-col items-end gap-1">
          <span className="font-bold text-sm text-primary-700">
{stock.skill_score.toFixed(1)}
          </span>
          <ScoreBar score={stock.skill_score} />
        </div>
      </td>
      <td className="text-right">
        <span className="text-sm font-medium text-slate-700">
{Number(stock.big_holder_ratio).toFixed(2)}%
        </span>
      </td>
      <td className="text-right">
        <ChangeTag value={weekChange} unit="%" />
      </td>
      <td className="text-right">
        <HolderChangeCell value={holderChange} />
      </td>
      <td className="text-right">
        <TrendIndicator value={trend} />
      </td>
      <td className="text-right pr-4">
        <Link
          href={`/stock/${stock.stock_code}`}
          className="text-xs text-primary-600 hover:text-primary-800 font-medium flex items-center gap-0.5 justify-end"
        >
          詳情 <ChevronRight size={11} />
        </Link>
      </td>
    </tr>
  )
}

function HolderChangeCell({ value }: { value: number }) {
  if (value === 0) return <span className="text-xs text-slate-400">—</span>
  const isDown = value < 0
  return (
    <span className={clsx('text-xs font-medium', isDown ? 'text-down' : 'text-up')}>
{isDown ? '▼' : '▲'} {Math.abs(value).toLocaleString()}
    </span>
  )
}

function TrendIndicator({ value }: { value: number }) {
  if (Math.abs(value) < 0.01) {
    return <span className="text-xs text-slate-400">持平</span>
}
  const isUp = value > 0
  return (
    <div className={clsx('flex items-center gap-1 justify-end text-xs font-medium',
      isUp ? 'text-up' : 'text-down'
    )}>
{isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
{value > 0 ? '+' : ''}{value.toFixed(2)}%
    </div>
  )
}

function SkeletonTable() {
  return (
    <div className="p-6">
{Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-4 mb-3">
          <div className="skeleton h-4 w-6 rounded" />
          <div className="skeleton h-4 flex-1 rounded" />
          <div className="skeleton h-4 w-16 rounded" />
          <div className="skeleton h-4 w-16 rounded" />
        </div>
      ))}
    </div>
  )
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <AlertTriangle size={32} className="mb-3 text-amber-400" />
      <p className="font-medium">無法載入數據</p>
      <p className="text-xs mt-1">請稍後再試</p>
    </div>
  )
}
