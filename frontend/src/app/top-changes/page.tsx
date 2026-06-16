'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { TrendingUp, TrendingDown, AlertTriangle, Target, Flame, Users, ChevronRight, Star, Download, Save, History } from 'lucide-react'
import clsx from 'clsx'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())

type Market = 'twse' | 'tpex'

interface StockChange {
  stock_code: string
  stock_name?: string
  market?: string
  industry?: string
  latest_week_change: number
  latest_ratio: number
  analysis_date?: string
}

interface ApiResponse {
  meta?: { type: string; market: string; limit: number; count: number }
  data?: StockChange[]
}

interface BHRow {
  stock_code: string
  stock_name: string
  market: string
  industry: string
  week_changes: Record<string, number | null>
  total_change: number
  latest_change: number
  latest_ratio: number
  week_dates: string[]
  price?: { close: number; change: number; change_pct: number } | null
}

interface BHResponse {
  meta: { week_dates: string[]; count: number }
  data: BHRow[]
}

interface ScoredRow extends BHRow { score: number }

function formatDate(d: string): string {
  if (!d) return ''
  if (d.length === 8) return d.slice(4,6) + '/' + d.slice(6,8)
  if (d.length === 10) return d.slice(5,7) + '/' + d.slice(8,10)
  return d
}

function ChangeCell({ value }: { value: number | null | undefined }) {
  if (value == null) return <td className="text-center text-slate-300 px-2 py-2 text-xs">—</td>
  if (value === 0) return <td className="text-center text-slate-400 px-2 py-2 text-xs">0.00</td>
  const pos = value > 0
  return <td className={`text-center px-2 py-2 text-xs font-medium ${pos ? 'text-red-600' : 'text-green-600'}`}>
    {pos ? '+' : ''}{value.toFixed(2)}
  </td>
}

function downloadCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const bom = '\uFEFF'
  const csvContent = bom + [headers.join(','), ...rows.map(r => r.map(c => {
    const s = String(c ?? '')
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
  }).join(','))].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function scoreStock(row: BHRow, weekDates: string[]): number {
  let score = 0
  const changes = weekDates.map(d => row.week_changes[d] ?? 0)
  score += Math.min(row.total_change * 2, 30)
  let streak = 0
  for (let i = changes.length - 1; i >= 0; i--) {
    if ((changes[i] ?? 0) > 0) streak++; else break
  }
  score += streak * 5
  score += Math.min((row.latest_change > 0 ? row.latest_change : 0) * 3, 20)
  score += Math.min(row.latest_ratio * 0.2, 15)
  return Math.round(score * 10) / 10
}

function getDivergenceAlert(row: BHRow): string | null {
  if (row.latest_change > 1 && row.total_change > 2) return '大股東持續買進'
  if (row.latest_change < -1) return '大股東減持警示'
  return null
}

function isEtf(code: string): boolean {
  return /^0[0-9]/.test(code)
}

function shouldInclude(r: BHRow | StockChange): boolean {
  const code = r.stock_code || ''
  const name = (r as BHRow).stock_name || (r as StockChange).stock_name || ''
  const industry = (r as BHRow).industry || (r as StockChange).industry || ''
  if (!(industry && industry.trim())) return false
  if (industry === '存托憑證') return false
  if (name.endsWith('-創') || name.endsWith('-特')) return false
  return true
}

// ─── 起漲標的 + Save + Download 整合組件 ────────────────────────────────────
function ScreenerWithSave({ market }: { market: Market }) {
  const { data, isLoading } = useSWR<BHResponse>(
    `${API_BASE}/api/big-holder-changes?market=${market}&limit=5000&sort=total_change&weeks=12&include_price=1`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const { data: pricesData } = useSWR<{ trade_date: string; data: Record<string, { close: number; change: number; change_pct: number }> }>(
    `${API_BASE}/api/prices`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 3600000 }
  )
  const priceMap = pricesData?.data || {}
  const priceDate = pricesData?.trade_date ? (pricesData.trade_date.slice(4,6) + '/' + pricesData.trade_date.slice(6,8)) : ''

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveMsg, setSaveMsg] = useState('')

  const rows: BHRow[] = data?.data || []
  const weekDates = data?.meta?.week_dates || (rows[0]?.week_dates || [])

  const scored: ScoredRow[] = rows
    .filter(r => shouldInclude(r) && r.total_change > 0 && r.latest_ratio > 10)
    .map(r => ({ ...r, score: scoreStock(r, weekDates) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)

  const handleDownload = () => {
    if (!scored.length) return
    const recentDates = weekDates.slice(-6)
    const headers = ['排名', '股票代號', '股票名稱', '產業', ...recentDates.map(d => formatDate(d)), '累計增幅', '持有%', '評分', '收盤價', '漲跌%', '信號']
    const csvRows = scored.map((row, idx) => [
      idx + 1, row.stock_code, row.stock_name || '', row.industry || '',
      ...recentDates.map(d => row.week_changes[d] ?? ''),
      row.total_change, row.latest_ratio, row.score,
      (priceMap[row.stock_code] || row.price)?.close ?? '', (priceMap[row.stock_code] || row.price)?.change_pct ?? '',
      getDivergenceAlert(row) || ''
    ])
    downloadCSV(`起漲潛力Top20_${market}_${new Date().toISOString().slice(0,10)}.csv`, headers, csvRows)
  }

  const handleSave = async () => {
    if (!scored.length) return
    setSaveStatus('saving')
    try {
      const latestDate = weekDates[weekDates.length - 1] || new Date().toISOString().slice(0,10).replace(/-/g,'')
      const payload = {
        snapshot_date: latestDate,
        market: market,
        stocks: scored.map(r => ({
          stock_code: r.stock_code, stock_name: r.stock_name, industry: r.industry,
          score: r.score, total_change: r.total_change, latest_ratio: r.latest_ratio,
          latest_change: r.latest_change, close_price: (priceMap[r.stock_code] || r.price)?.close, change_pct: (priceMap[r.stock_code] || r.price)?.change_pct
        }))
      }
      const res = await fetch(`${API_BASE}/api/screener-snapshot`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      })
      const result = await res.json() as { success?: boolean; message?: string; error?: string }
      if (result.success) { setSaveStatus('saved'); setSaveMsg(result.message || '儲存成功') }
      else { setSaveStatus('error'); setSaveMsg(result.error || '儲存失敗') }
    } catch(e) {
      setSaveStatus('error'); setSaveMsg('網路錯誤')
    }
    setTimeout(() => setSaveStatus('idle'), 3000)
  }

  if (isLoading) return <div className="flex items-center justify-center py-8 text-slate-400 text-sm"><span className="animate-spin mr-2 text-lg">⟳</span>分析中...</div>
  if (scored.length === 0) return <div className="flex items-center justify-center py-8 text-slate-400 text-sm">暫無符合條件標的</div>

  const displayDates = weekDates.slice(-6)

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50">
        <span className="text-xs text-slate-500">Top 20 起漲潛力標的 · {market === 'twse' ? '上市' : market === 'tpex' ? '上櫃' : 'ETF'}</span>
        <div className="flex items-center gap-2">
          {saveStatus === 'saved' && <span className="text-xs text-green-600">{saveMsg}</span>}
          {saveStatus === 'error' && <span className="text-xs text-red-500">{saveMsg}</span>}
          <button onClick={handleDownload} className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-primary-600 hover:bg-white rounded border border-transparent hover:border-slate-200">
            <Download className="w-3 h-3" />CSV
          </button>
          <button onClick={handleSave} disabled={saveStatus === 'saving'} className="flex items-center gap-1 px-3 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 transition-colors">
            <Save className="w-3 h-3" />{saveStatus === 'saving' ? '儲存中...' : '儲存本週選股'}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 text-slate-500 font-medium w-8">#</th>
              <th className="text-left px-3 py-2 text-slate-500 font-medium">股票</th>
              <th className="text-left px-3 py-2 text-slate-500 font-medium hidden md:table-cell">產業</th>
              {displayDates.map(d => <th key={d} className="text-center px-2 py-2 text-slate-500 font-medium text-xs">{formatDate(d)}</th>)}
              <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs">累計</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs">持有%</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs">評分</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs hidden md:table-cell">{priceDate ? priceDate + ' 收盤' : '收盤'}</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs hidden md:table-cell">漲跌%</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs">信號</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {scored.map((row, idx) => {
              const rowPrice = priceMap[row.stock_code] || row.price || null
              const alert = getDivergenceAlert(row)
              return (
                <tr key={row.stock_code} className="hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-2 text-slate-400 text-xs">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <Link href={`/stock/${row.stock_code}`} className="group">
                      <span className="font-mono font-semibold text-slate-800 group-hover:text-primary-600">{row.stock_code}</span>
                      {row.stock_name && <span className="ml-1.5 text-slate-500 text-xs">{row.stock_name}</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs hidden md:table-cell">{row.industry || '—'}</td>
                  {displayDates.map(d => <ChangeCell key={d} value={row.week_changes[d]} />)}
                  <td className="text-center px-2 py-2 text-xs font-bold text-red-600">+{row.total_change.toFixed(2)}</td>
                  <td className="text-center px-2 py-2 text-xs text-slate-700">{row.latest_ratio.toFixed(2)}%</td>
                  <td className="text-center px-2 py-2">
                    <span className={clsx('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-bold', row.score >= 50 ? 'bg-red-100 text-red-700' : row.score >= 30 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600')}>
                      <Star className="w-3 h-3" />{row.score}
                    </span>
                  </td>
                  <td className="text-center px-2 py-2 text-xs hidden md:table-cell">{rowPrice?.close ? rowPrice.close.toFixed(2) : '—'}</td>
                  <td className={clsx('text-center px-2 py-2 text-xs hidden md:table-cell', rowPrice && rowPrice.change_pct > 0 ? 'text-red-600' : rowPrice && rowPrice.change_pct < 0 ? 'text-green-600' : 'text-slate-400')}>
                    {rowPrice?.change_pct != null ? (rowPrice.change_pct > 0 ? '+' : '') + rowPrice.change_pct.toFixed(2) + '%' : '—'}
                  </td>
                  <td className="text-center px-2 py-2 text-xs">
                    {alert ? <span className={clsx('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap', alert.includes('買進') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600')}>{alert.includes('買進') ? <Flame className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}{alert}</span> : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── 本週主力異動 Panel ───────────────────────────────────────────────────────
function WeeklyChangesPanel({ market }: { market: Market }) {
  const [type, setType] = useState<'increase' | 'decrease'>('increase')
  const { data: rawData, isLoading } = useSWR<ApiResponse | StockChange[]>(
    `${API_BASE}/api/top-changes?market=${market}&type=${type}&limit=20`,
    fetcher, { refreshInterval: 60000 }
  )
  const data: StockChange[] = Array.isArray(rawData) ? rawData : ((rawData as ApiResponse)?.data || [])
  const filtered = data.filter(s => shouldInclude(s))

  const handleDownload = () => {
    const headers = ['股票代號', '股票名稱', '市場', '產業', '本週變化%', '大股東持有%']
    const rows = filtered.map(s => [s.stock_code, s.stock_name || '', s.market || '', s.industry || '', s.latest_week_change, s.latest_ratio])
    downloadCSV(`本週異動_${type === 'increase' ? '買進' : '賣出'}_${market}.csv`, headers, rows)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
          {(['increase', 'decrease'] as const).map(t => (
            <button key={t} onClick={() => setType(t)} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', type === t ? t === 'increase' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600' : 'text-slate-500 hover:bg-slate-50')}>
              {t === 'increase' ? <><TrendingUp className="w-4 h-4" />主力買進</> : <><TrendingDown className="w-4 h-4" />主力賣出</>}
            </button>
          ))}
        </div>
        {filtered.length > 0 && (
          <button onClick={handleDownload} className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-primary-600 hover:bg-slate-50 rounded">
            <Download className="w-3 h-3" />CSV下載
          </button>
        )}
      </div>
      {isLoading && <div className="flex items-center justify-center py-8 text-slate-400 text-sm"><span className="animate-spin mr-2">⟳</span>載入中...</div>}
      {!isLoading && filtered.length === 0 && <div className="py-8 text-center text-slate-400 text-sm">暫無資料</div>}
      {!isLoading && filtered.length > 0 && (
        <div className="divide-y divide-slate-100">
          {filtered.map((s, i) => {
            const change = s.latest_week_change ?? 0
            const pos = change > 0
            return (
              <Link key={s.stock_code} href={`/stock/${s.stock_code}`} className="flex items-center px-2 py-2.5 hover:bg-slate-50 transition-colors group">
                <span className="w-6 text-xs text-slate-400 font-medium">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800 group-hover:text-primary-600">{s.stock_code}</span>
                    {s.stock_name && <span className="text-xs text-slate-500 truncate">{s.stock_name}</span>}
                    {s.market && <span className="text-xs px-1 py-0.5 rounded bg-slate-100 text-slate-400">{s.market === 'twse' ? '上市' : s.market === 'tpex' ? '上櫃' : s.market}</span>}
                  </div>
                  {s.industry && <div className="text-xs text-slate-400 mt-0.5">{s.industry}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={clsx('text-sm font-bold', pos ? 'text-red-600' : change < 0 ? 'text-green-600' : 'text-slate-400')}>{pos ? '+' : ''}{change.toFixed(2)}%</span>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── 12週籌碼熱力圖 Panel ─────────────────────────────────────────────────────
function HeatmapPanel({ market }: { market: Market }) {
  const { data, isLoading } = useSWR<BHResponse>(
    `${API_BASE}/api/big-holder-changes?market=${market}&limit=50&sort=total_change&weeks=12`,
    fetcher, { revalidateOnFocus: false }
  )
  if (isLoading) return <div className="flex items-center justify-center py-8 text-slate-400 text-sm"><span className="animate-spin mr-2">⟳</span>計算熱力圖...</div>
  let rows: BHRow[] = (data?.data || [])
  rows = rows.filter(r => shouldInclude(r)).slice(0, 30)
  const weekDates = data?.meta?.week_dates || (rows[0]?.week_dates || [])
  if (rows.length === 0) return <div className="py-8 text-center text-slate-400 text-sm">暫無資料</div>

  function cellColor(v: number | null | undefined): string {
    if (v == null) return 'bg-slate-100'
    if (v >= 2) return 'bg-red-600 text-white'
    if (v >= 1) return 'bg-red-400 text-white'
    if (v >= 0.5) return 'bg-red-200 text-red-900'
    if (v > 0) return 'bg-red-50 text-red-700'
    if (v === 0) return 'bg-slate-50 text-slate-400'
    if (v >= -0.5) return 'bg-green-50 text-green-700'
    if (v >= -1) return 'bg-green-200 text-green-900'
    if (v >= -2) return 'bg-green-400 text-white'
    return 'bg-green-600 text-white'
  }

  const handleDownload = () => {
    const headers = ['股票代號', '股票名稱', ...weekDates.map(d => formatDate(d)), '累計']
    const csvRows = rows.map(r => [r.stock_code, r.stock_name, ...weekDates.map(d => r.week_changes[d] ?? ''), r.total_change])
    downloadCSV(`12週熱力圖_${market}.csv`, headers, csvRows)
  }

  return (
    <div className="overflow-x-auto">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-600 inline-block"/>大幅增持</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block"/>小幅增持</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-100 inline-block"/>持平</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 inline-block"/>小幅減持</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-600 inline-block"/>大幅減持</span>
        </div>
        <button onClick={handleDownload} className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-primary-600 hover:bg-slate-50 rounded">
          <Download className="w-3 h-3" />CSV下載
        </button>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left px-2 py-1.5 text-slate-500 font-medium sticky left-0 bg-white min-w-[100px]">股票</th>
            {weekDates.map(d => <th key={d} className="text-center px-1 py-1.5 text-slate-400 font-medium min-w-[42px]">{formatDate(d)}</th>)}
            <th className="text-center px-2 py-1.5 text-slate-500 font-medium">累計</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.stock_code} className="border-t border-slate-100">
              <td className="px-2 py-1 sticky left-0 bg-white">
                <Link href={`/stock/${row.stock_code}`} className="hover:text-primary-600">
                  <span className="font-mono font-semibold">{row.stock_code}</span>
                  {row.stock_name && <span className="ml-1 text-slate-400">{row.stock_name}</span>}
                </Link>
              </td>
              {weekDates.map(d => {
                const v = row.week_changes[d]
                return <td key={d} className={`text-center px-1 py-1 ${cellColor(v)}`} title={`${d}: ${v != null ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '—'}`}>
                  {v != null && v !== 0 ? (v > 0 ? '+' : '') + v.toFixed(1) : '·'}
                </td>
              })}
              <td className={`text-center px-2 py-1 font-bold ${row.total_change > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {row.total_change > 0 ? '+' : ''}{row.total_change.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── 股東人數背離警示 Panel ───────────────────────────────────────────────────
function DivergencePanel({ market }: { market: Market }) {
  const { data, isLoading } = useSWR<BHResponse>(
    `${API_BASE}/api/big-holder-changes?market=${market}&limit=5000&sort=total_change&weeks=6`,
    fetcher, { revalidateOnFocus: false }
  )
  if (isLoading) return <div className="flex items-center justify-center py-8 text-slate-400 text-sm"><span className="animate-spin mr-2">⟳</span>分析中...</div>
  let rows: BHRow[] = data?.data || []
  rows = rows.filter(r => shouldInclude(r))
  const weekDates = data?.meta?.week_dates || []
  const strongBuy = rows.filter(r => { const rc = weekDates.slice(-3).map(d => r.week_changes[d] ?? 0); return rc.every(v => v > 0) && r.total_change > 3 && r.latest_ratio > 20 }).slice(0, 15)
  const strongSell = rows.filter(r => r.latest_change < -2 && r.total_change < 0).sort((a, b) => a.latest_change - b.latest_change).slice(0, 10)
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1.5"><Flame className="w-4 h-4" />大股東持續買進（近3週均增持）</h3>
        {strongBuy.length === 0 ? <div className="text-sm text-slate-400 py-4 text-center">暫無符合條件標的</div> : (
          <div className="divide-y divide-slate-100">
            {strongBuy.map(row => {
              const recent3 = weekDates.slice(-3).map(d => row.week_changes[d] ?? 0)
              return <Link key={row.stock_code} href={`/stock/${row.stock_code}`} className="flex items-center gap-3 px-2 py-2.5 hover:bg-slate-50 group">
                <div className="flex-1"><span className="font-mono font-semibold text-slate-800 group-hover:text-primary-600">{row.stock_code}</span>{row.stock_name && <span className="ml-1.5 text-xs text-slate-500">{row.stock_name}</span>}{row.industry && <span className="ml-1.5 text-xs text-slate-400">{row.industry}</span>}</div>
                <div className="flex items-center gap-1.5 text-xs">
                  {recent3.map((v, i) => <span key={i} className={clsx('px-1.5 py-0.5 rounded font-medium', v > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600')}>{v > 0 ? '+' : ''}{v.toFixed(2)}</span>)}
                  <span className="ml-1 font-bold text-red-700">累計+{row.total_change.toFixed(2)}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
              </Link>
            })}
          </div>
        )}
      </div>
      <div className="border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />大股東減持警示（本週大幅賣出）</h3>
        {strongSell.length === 0 ? <div className="text-sm text-slate-400 py-4 text-center">本週無大幅減持標的</div> : (
          <div className="divide-y divide-slate-100">
            {strongSell.map(row => (
              <Link key={row.stock_code} href={`/stock/${row.stock_code}`} className="flex items-center gap-3 px-2 py-2.5 hover:bg-slate-50 group">
                <div className="flex-1"><span className="font-mono font-semibold text-slate-800 group-hover:text-primary-600">{row.stock_code}</span>{row.stock_name && <span className="ml-1.5 text-xs text-slate-500">{row.stock_name}</span>}{row.industry && <span className="ml-1.5 text-xs text-slate-400">{row.industry}</span>}</div>
                <span className="text-sm font-bold text-green-700">{row.latest_change.toFixed(2)}%</span>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 回測歷史 Panel ───────────────────────────────────────────────────────────
interface SnapshotDate { snapshot_date: string; market: string; count: number }
interface SnapshotRow { id: number; snapshot_date: string; market: string; stock_code: string; stock_name: string; industry: string; score: number; total_change: number; latest_ratio: number; latest_change: number; close_price: number; change_pct: number }

function HistoryPanel() {
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedMarket, setSelectedMarket] = useState('all')
  const { data: histMeta } = useSWR<{ dates: SnapshotDate[] }>(`${API_BASE}/api/screener-history?limit=1`, fetcher, { revalidateOnFocus: false })
  const dates = histMeta?.dates || []
  const { data: histData, isLoading } = useSWR<{ data: SnapshotRow[] }>(
    selectedDate ? `${API_BASE}/api/screener-history?date=${selectedDate}&market=${selectedMarket}&limit=100` : null,
    fetcher, { revalidateOnFocus: false }
  )
  const rows = histData?.data || []

  const handleDownload = () => {
    if (!rows.length) return
    const headers = ['快照日期', '市場', '股票代號', '股票名稱', '產業', '評分', '累計增幅', '持有%', '本週變化', '收盤價', '漲跌%']
    const csvRows = rows.map(r => [r.snapshot_date, r.market, r.stock_code, r.stock_name, r.industry, r.score, r.total_change, r.latest_ratio, r.latest_change, r.close_price, r.change_pct])
    downloadCSV(`起漲潛力歷史_${selectedDate}_${selectedMarket}.csv`, headers, csvRows)
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5"><History className="w-4 h-4" />起漲潛力歷史快照</h3>
        <p className="text-xs text-slate-400 mb-3">每週儲存的起漲潛力選股，可用於回測績效追蹤</p>
        {dates.length === 0 && <div className="text-sm text-slate-400 py-4 text-center">尚無歷史快照。請先在「起漲潛力」面板點擊「儲存本週選股」</div>}
        {dates.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {dates.map(d => (
              <button key={d.snapshot_date + d.market} onClick={() => { setSelectedDate(d.snapshot_date); setSelectedMarket(d.market) }}
                className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors', selectedDate === d.snapshot_date && selectedMarket === d.market ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-600 border-slate-200 hover:border-primary-400')}>
                {formatDate(d.snapshot_date)} {d.market === 'twse' ? '上市' : d.market === 'tpex' ? '上櫃' : d.market} ({d.count}檔)
              </button>
            ))}
          </div>
        )}
      </div>
      {isLoading && <div className="flex items-center justify-center py-8 text-slate-400 text-sm"><span className="animate-spin mr-2">⟳</span>載入中...</div>}
      {!isLoading && selectedDate && rows.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">{formatDate(selectedDate)} 共 {rows.length} 檔</span>
            <button onClick={handleDownload} className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-primary-600 hover:bg-slate-50 rounded">
              <Download className="w-3 h-3" />CSV下載
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 text-slate-500 font-medium">#</th>
                  <th className="text-left px-3 py-2 text-slate-500 font-medium">股票</th>
                  <th className="text-left px-3 py-2 text-slate-500 font-medium hidden md:table-cell">產業</th>
                  <th className="text-center px-2 py-2 text-slate-500 font-medium">評分</th>
                  <th className="text-center px-2 py-2 text-slate-500 font-medium">累計增幅</th>
                  <th className="text-center px-2 py-2 text-slate-500 font-medium">持有%</th>
                  <th className="text-center px-2 py-2 text-slate-500 font-medium">收盤</th>
                  <th className="text-center px-2 py-2 text-slate-500 font-medium">漲跌%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <Link href={`/stock/${row.stock_code}`} className="hover:text-primary-600">
                        <span className="font-mono font-semibold text-slate-800">{row.stock_code}</span>
                        {row.stock_name && <span className="ml-1.5 text-slate-500">{row.stock_name}</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-500 hidden md:table-cell">{row.industry || '—'}</td>
                    <td className="text-center px-2 py-2">
                      <span className={clsx('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-bold', row.score >= 50 ? 'bg-red-100 text-red-700' : row.score >= 30 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600')}>
                        <Star className="w-3 h-3" />{row.score}
                      </span>
                    </td>
                    <td className="text-center px-2 py-2 text-red-600 font-bold">+{(row.total_change ?? 0).toFixed(2)}</td>
                    <td className="text-center px-2 py-2 text-slate-700">{(row.latest_ratio ?? 0).toFixed(2)}%</td>
                    <td className="text-center px-2 py-2 text-slate-700">{row.close_price ? row.close_price.toFixed(2) : '—'}</td>
                    <td className={`text-center px-2 py-2 ${(row.change_pct ?? 0) > 0 ? 'text-red-600' : (row.change_pct ?? 0) < 0 ? 'text-green-600' : 'text-slate-400'}`}>
                      {row.change_pct != null ? ((row.change_pct > 0 ? '+' : '') + row.change_pct.toFixed(2) + '%') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type Panel = 'screener' | 'weekly' | 'heatmap' | 'divergence' | 'history'

const PANELS: { id: Panel; label: string; icon: React.ElementType; desc: string }[] = [
  { id: 'screener', label: '起漲潛力', icon: Target, desc: '上市/上櫃各Top 20評分標的' },
  { id: 'weekly', label: '本週異動', icon: TrendingUp, desc: '本週主力大幅買賣標的' },
  { id: 'heatmap', label: '12週熱力圖', icon: Flame, desc: '籌碼變化視覺化熱力圖' },
  { id: 'divergence', label: '持股背離', icon: Users, desc: '大股東買賣強度警示' },
  { id: 'history', label: '回測追蹤', icon: History, desc: '起漲潛力歷史快照回測' },
]

const MARKETS: { id: Market; label: string }[] = [
  { id: 'twse', label: '上市' },
  { id: 'tpex', label: '上櫃' },
]

export default function TopChangesPage() {
  const [panel, setPanel] = useState<Panel>('screener')
  const [market, setMarket] = useState<Market>('twse')

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">大股東籌碼集中度分析</h1>
        <p className="text-sm text-slate-500 mt-1">起漲潛力標的篩選 · 12週籌碼熱力圖 · 持股背離警示 · 回測追蹤</p>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
        {PANELS.map(p => {
          const Icon = p.icon
          return (
            <button key={p.id} onClick={() => setPanel(p.id)} className={clsx(
              'flex flex-col items-start p-3 rounded-xl border transition-all text-left',
              panel === p.id ? 'border-primary-500 bg-primary-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
            )}>
              <Icon className={clsx('w-5 h-5 mb-1.5', panel === p.id ? 'text-primary-600' : 'text-slate-400')} />
              <span className={clsx('font-semibold text-sm', panel === p.id ? 'text-primary-700' : 'text-slate-700')}>{p.label}</span>
              <span className="text-xs text-slate-400 mt-0.5 hidden md:block">{p.desc}</span>
            </button>
          )
        })}
      </div>

      {panel !== 'history' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">市場：</span>
          {MARKETS.map(m => (
            <button key={m.id} onClick={() => setMarket(m.id)} className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', market === m.id ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {panel !== 'history' && (
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            {(() => { const p = PANELS.find(p => p.id === panel)!; const Icon = p.icon; return <><Icon className="w-4 h-4 text-primary-600" /><span className="font-semibold text-slate-800">{p.label}</span><span className="text-xs text-slate-400 ml-1">{p.desc}</span></> })()}
          </div>
        )}
        <div>
          {panel === 'screener' && <ScreenerWithSave market={market} />}
          {panel === 'weekly' && <div className="p-4"><WeeklyChangesPanel market={market} /></div>}
          {panel === 'heatmap' && <div className="p-4"><HeatmapPanel market={market} /></div>}
          {panel === 'divergence' && <div className="p-4"><DivergencePanel market={market} /></div>}
          {panel === 'history' && <div className="p-4"><HistoryPanel /></div>}
        </div>
      </div>
    </div>
  )
}
