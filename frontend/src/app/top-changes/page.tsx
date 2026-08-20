'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { TrendingUp, TrendingDown, AlertTriangle, Target, Flame, Users, Star, Download, Save, History, Zap } from 'lucide-react'
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
    capital_reduction_suspected?: boolean
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
    capital_reduction_suspected?: boolean
}

interface BHResponse {
  meta: { week_dates: string[]; count: number }
  data: BHRow[]
}

interface ScoredRow extends BHRow { score: number }

interface TechnicalPoint {
  date: string
  close: number
  volume: number
  k: number
  d: number
  dif: number
  dea: number
  hist: number
}

interface TechnicalResponse {
  stock_code: string
  source: string
  latest: TechnicalPoint
  series: TechnicalPoint[]
}

interface TechnicalBonusParams {
  kThreshold: number
  volumeMultiplier: number
}

interface TechnicalBonusResult {
  bonus: number
  signals: string[]
}

interface FinalRow extends ScoredRow {
  techBonus: number
  techSignals: string[]
}

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

// 技術指標共振加分：KD 黃金交叉（K值低於門檻）、MACD 柱狀圖翻正、成交量較5日均量放大達門檻倍數
// 三項各 +10 分，最高 +30 分；僅套用於籌碼分數排序後的候選股，抓不到資料則以 0 分計
function calcTechnicalBonus(series: TechnicalPoint[] | undefined, params: TechnicalBonusParams): TechnicalBonusResult {
  if (!series || series.length < 7) return { bonus: 0, signals: [] }
  const last = series[series.length - 1]
  const prev = series[series.length - 2]
  const signals: string[] = []
  let bonus = 0
  if (prev.k <= prev.d && last.k > last.d && last.k <= params.kThreshold) {
    bonus += 10
    signals.push('KD黃金交叉')
  }
  if (prev.hist <= 0 && last.hist > 0) {
    bonus += 10
    signals.push('MACD翻正')
  }
  const last5 = series.slice(-6, -1)
  if (last5.length === 5) {
    const avgVol = last5.reduce((s, r) => s + r.volume, 0) / 5
    if (avgVol > 0 && last.volume / avgVol >= params.volumeMultiplier) {
      bonus += 10
      signals.push('量能放大')
    }
  }
  return { bonus, signals }
}

function getDivergenceAlert(row: BHRow): string | null {
  if (row.latest_change > 1 && row.total_change > 2) return '大股東持續買進'
  if (row.latest_change < -1) return '大股東減持警示'
  return null
}

function isEtf(code: string): boolean {
  return /^0[0-9]/.test(code)
}

// 篩選邏輯：排除無產業別、ETF、存託憑證、創新板股票、已下市、特別股。
// 特別股/權證以證券代碼格式（4位數字+英文字母）判斷；創新板股票除產業別欄位外，另以名稱結尾「-創」或「-KY創」輔助判斷，
// 因部分創新板個股的產業別欄位仍為原產業分類、未標示為「創新板股票」，故需以名稱後綴補強排除；一般股票名稱極少以「-創」或「-KY創」結尾，誤判風險低。
function shouldInclude(r: BHRow | StockChange): boolean {
  const code = r.stock_code || ''; const name = r.stock_name || ''
  const industry = (r as BHRow).industry || (r as StockChange).industry || ''
  if (!(industry && industry.trim())) return false
  if (industry === 'ETF') return false
  if (industry === '存託憑證' || industry === '存托憑證') return false
  if (industry === '創新板股票' || industry === '創新版') return false
  if (industry === '已下市' || industry === '特別股') return false; if (name.endsWith('-創') || name.endsWith('-KY創')) return false
  if (/^\d{4}[A-Z]/.test(code)) return false
    if ((r as BHRow).capital_reduction_suspected || (r as StockChange).capital_reduction_suspected) return false
  return true
}

// ─── 評分邏輯說明 Panel ───────────────────────────────────────────────────────
function ScoringExplanation({ useResonance, kThreshold, volumeMultiplier }: { useResonance: boolean; kThreshold: number; volumeMultiplier: number }) {
  return (
    <div className="mx-4 mt-3 mb-1 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-2">
      <p className="font-semibold text-slate-700">評分邏輯說明</p>
      <p>基礎籌碼分數：12週大股東持股比累計變動 × 2（最高30分）＋ 連續增持週數 × 5（無上限）＋ 最新一週變動 × 3（僅正值計分，最高20分）＋ 最新持股比 × 0.2（最高15分）。此分數僅反映大股東籌碼集中度變化，不含股價或技術面因素。</p>
      <p>篩選排除：無產業別、ETF、存託憑證、創新板股票、已下市、特別股（以證券代碼格式判斷，例如4位數字加英文字母）；創新板股票並以名稱結尾「-創」或「-KY創」輔助排除（因部分創新板個股產業別欄位未標示為「創新板股票」）。</p>
      {useResonance ? (
        <p>技術指標共振加分（僅套用於籌碼分數前60名候選股，目前門檻：K值≤{kThreshold}、當日量能≥5日均量的{volumeMultiplier}倍）：KD黃金交叉且K值處於低檔（≤門檻）+10分；MACD柱狀圖由負轉正 +10分；成交量放大達門檻倍數以上 +10分，三項最高共+30分。若無法取得該股技術資料，此項加分以0分計。</p>
      ) : (
        <p>技術指標共振（日成交量 / KD / MACD）目前未啟用，勾選上方「技術指標共振」即可將其疊加到基礎籌碼分數中，門檻可自行調整。</p>
      )}
    </div>
  )
}

// ─── 籌碼變化 + 股價 共用表格（本週異動 / 持股背離 皆使用） ─────────────────────
function HolderPriceTable({ rows, weekDates, priceMap, priceDate, emptyMessage }: {
  rows: BHRow[]
  weekDates: string[]
  priceMap: Record<string, { close: number; change: number; change_pct: number }>
  priceDate: string
  emptyMessage: string
}) {
  const displayDates = weekDates.slice(-6)
  if (rows.length === 0) return <div className="text-sm text-slate-400 py-4 text-center">{emptyMessage}</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-3 py-2 text-slate-500 font-medium w-8">#</th>
            <th className="text-left px-3 py-2 text-slate-500 font-medium">股票</th>
            <th className="text-left px-3 py-2 text-slate-500 font-medium hidden md:table-cell whitespace-nowrap">產業</th>
            {displayDates.map(d => <th key={d} className="text-center px-2 py-2 text-slate-500 font-medium text-xs">{formatDate(d)}</th>)}
            <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs">累計</th>
            <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs">持有%</th>
            <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs hidden md:table-cell whitespace-nowrap">{priceDate ? priceDate + ' 收盤' : '收盤'}</th>
            <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs hidden md:table-cell">漲跌</th>
            <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs hidden md:table-cell">漲跌幅</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, idx) => {
            const rowPrice = priceMap[row.stock_code] || row.price || null
            return (
              <tr key={row.stock_code} className="hover:bg-slate-50 transition-colors">
                <td className="px-3 py-2 text-slate-400 text-xs">{idx + 1}</td>
                <td className="px-3 py-2">
                  <Link href={`/stock/${row.stock_code}`} className="group">
                    <span className="font-semibold text-slate-800 group-hover:text-primary-600">{row.stock_code}</span>
                    {row.stock_name && <span className="ml-1.5 text-slate-500 text-xs">{row.stock_name}</span>}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs hidden md:table-cell whitespace-nowrap">{row.industry || '—'}</td>
                {displayDates.map(d => <ChangeCell key={d} value={row.week_changes[d]} />)}
                <td className={clsx('text-center px-2 py-2 text-xs font-bold', row.total_change > 0 ? 'text-red-600' : row.total_change < 0 ? 'text-green-600' : 'text-slate-400')}>
                  {row.total_change > 0 ? '+' : ''}{row.total_change.toFixed(2)}
                </td>
                <td className="text-center px-2 py-2 text-xs text-slate-700">{row.latest_ratio.toFixed(2)}%</td>
                <td className="text-center px-2 py-2 text-xs hidden md:table-cell">{rowPrice?.close ? rowPrice.close.toFixed(2) : '—'}</td>
                <td className={clsx('text-center px-2 py-2 text-xs hidden md:table-cell', rowPrice && rowPrice.change > 0 ? 'text-red-600' : rowPrice && rowPrice.change < 0 ? 'text-green-600' : 'text-slate-400')}>
                  {rowPrice?.change != null ? (rowPrice.change > 0 ? '+' : '') + rowPrice.change.toFixed(2) : '—'}
                </td>
                <td className={clsx('text-center px-2 py-2 text-xs hidden md:table-cell', rowPrice && rowPrice.change_pct > 0 ? 'text-red-600' : rowPrice && rowPrice.change_pct < 0 ? 'text-green-600' : 'text-slate-400')}>
                  {rowPrice?.change_pct != null ? (rowPrice.change_pct > 0 ? '+' : '') + rowPrice.change_pct.toFixed(2) + '%' : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
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

  const { data: industriesData } = useSWR<{ market: string; industries: string[] }>(
    `${API_BASE}/api/industries?market=${market}`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const industries = industriesData?.industries || []

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveMsg, setSaveMsg] = useState('')
  const [showExplain, setShowExplain] = useState(false)
  const [useResonance, setUseResonance] = useState(false)
  const [kThreshold, setKThreshold] = useState(30)
  const [volumeMultiplier, setVolumeMultiplier] = useState(1.5)
  const [techMap, setTechMap] = useState<Record<string, TechnicalResponse | null>>({})
  const [techLoading, setTechLoading] = useState(false)
  const [industryFilter, setIndustryFilter] = useState('')
  const [minRatio, setMinRatio] = useState(0)
  const [maxRatio, setMaxRatio] = useState(100)

  const rows: BHRow[] = data?.data || []
  const weekDates = data?.meta?.week_dates || (rows[0]?.week_dates || [])

  // 篩選池：先套用產業別 + 大股東持有% 範圍篩選，作為統計列與評分的共同基礎
  const filteredPool: BHRow[] = rows.filter(r =>
    shouldInclude(r) &&
    (industryFilter === '' || r.industry === industryFilter) &&
    r.latest_ratio >= minRatio && r.latest_ratio <= maxRatio
  )

  const recentWeeks = weekDates.slice(-3)
  const streakUpCount = filteredPool.filter(r => recentWeeks.length > 0 && recentWeeks.every(d => (r.week_changes[d] ?? 0) > 0)).length
  const streakDownCount = filteredPool.filter(r => recentWeeks.length > 0 && recentWeeks.every(d => (r.week_changes[d] ?? 0) < 0)).length
  const avgRatio = filteredPool.length ? filteredPool.reduce((s, r) => s + r.latest_ratio, 0) / filteredPool.length : 0
  let todayUpCount = 0, todayDownCount = 0
  for (const r of filteredPool) {
    const p = priceMap[r.stock_code] || r.price
    if (p) { if (p.change_pct > 0) todayUpCount++; else if (p.change_pct < 0) todayDownCount++ }
  }

  const baseScored: ScoredRow[] = filteredPool
    .filter(r => r.total_change > 0 && r.latest_ratio > 10)
    .map(r => ({ ...r, score: scoreStock(r, weekDates) }))
    .sort((a, b) => b.score - a.score)

  const CANDIDATE_POOL_SIZE = 60
  const candidatePool = baseScored.slice(0, CANDIDATE_POOL_SIZE)
  const candidateCodes = candidatePool.map(r => r.stock_code).join(',')

  useEffect(() => {
    if (!useResonance || !candidateCodes) { setTechMap({}); return }
    let cancelled = false
    setTechLoading(true)
    const codes = candidateCodes.split(',')
    Promise.all(codes.map(async (code) => {
      try {
        const res = await fetch(`${API_BASE}/api/technical/${code}`)
        if (!res.ok) return [code, null] as const
        const json = await res.json() as TechnicalResponse
        return [code, json] as const
      } catch (_e) {
        return [code, null] as const
      }
    })).then(entries => {
      if (cancelled) return
      const map: Record<string, TechnicalResponse | null> = {}
      for (const [code, json] of entries) map[code] = json
      setTechMap(map)
      setTechLoading(false)
    })
    return () => { cancelled = true }
  }, [useResonance, candidateCodes])

  const finalRows: FinalRow[] = (useResonance ? candidatePool : baseScored)
    .map(r => {
      const tech = techMap[r.stock_code]
      const { bonus, signals } = useResonance
        ? calcTechnicalBonus(tech?.series, { kThreshold, volumeMultiplier })
        : { bonus: 0, signals: [] as string[] }
      return { ...r, score: Math.round((r.score + bonus) * 10) / 10, techBonus: bonus, techSignals: signals }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)

  const scored: FinalRow[] = finalRows

  const handleDownload = () => {
    if (!scored.length) return
    const recentDates = weekDates.slice(-6)
    const headers = ['排名', '股票代號', '股票名稱', '產業', ...recentDates.map(d => formatDate(d)), '累計增幅', '持有%', '評分', '技術加分', '技術信號', '收盤價', '漲跌%', '信號']
    const csvRows = scored.map((row, idx) => [
      idx + 1, row.stock_code, row.stock_name || '', row.industry || '',
      ...recentDates.map(d => row.week_changes[d] ?? ''),
      row.total_change, row.latest_ratio, row.score, row.techBonus, row.techSignals.join('/'),
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

  const displayDates = weekDates.slice(-6)

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50 flex-wrap gap-2">
        <span className="text-xs text-slate-500">Top 20 起漲潛力標的 · {market === 'twse' ? '上市' : market === 'tpex' ? '上櫃' : 'ETF'}</span>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1 text-xs text-slate-500">
            產業
            <select value={industryFilter} onChange={e => setIndustryFilter(e.target.value)} className="border border-slate-200 rounded px-1 py-0.5 text-xs max-w-[8rem]">
              <option value="">全部</option>
              {industries.map(ind => <option key={ind} value={ind}>{ind}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            持有%
            <input type="number" min={0} max={100} value={minRatio} onChange={e => setMinRatio(Number(e.target.value) || 0)} className="w-12 border border-slate-200 rounded px-1 py-0.5" />
            ~
            <input type="number" min={0} max={100} value={maxRatio} onChange={e => setMaxRatio(Number(e.target.value) || 0)} className="w-12 border border-slate-200 rounded px-1 py-0.5" />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input type="checkbox" checked={useResonance} onChange={e => setUseResonance(e.target.checked)} />
            技術指標共振
          </label>
          {useResonance && (
            <>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                K值≤
                <input type="number" value={kThreshold} onChange={e => setKThreshold(Number(e.target.value) || 0)} className="w-12 border border-slate-200 rounded px-1 py-0.5" />
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                量能≥
                <input type="number" step="0.1" value={volumeMultiplier} onChange={e => setVolumeMultiplier(Number(e.target.value) || 0)} className="w-14 border border-slate-200 rounded px-1 py-0.5" />
                倍
              </label>
              {techLoading && <span className="text-xs text-slate-400">技術指標載入中...</span>}
            </>
          )}
          <button onClick={() => setShowExplain(s => !s)} className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-primary-600 hover:bg-white rounded border border-transparent hover:border-slate-200">
            評分說明
          </button>
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
      <div className="flex items-center gap-4 flex-wrap px-4 py-2 border-b border-slate-100 text-xs text-slate-500">
        <span>篩選結果 <b className="text-slate-700">{filteredPool.length}</b> 檔</span>
        <span>連增≥3週 <b className="text-red-600">{streakUpCount}</b> 檔</span>
        <span>連減≥3週 <b className="text-green-600">{streakDownCount}</b> 檔</span>
        <span>平均持有% <b className="text-slate-700">{avgRatio.toFixed(1)}%</b></span>
        <span>今日漲跌 <b className="text-red-600">{todayUpCount}</b>↑ / <b className="text-green-600">{todayDownCount}</b>↓</span>
      </div>
      {showExplain && <ScoringExplanation useResonance={useResonance} kThreshold={kThreshold} volumeMultiplier={volumeMultiplier} />}
      {scored.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-slate-400 text-sm">暫無符合條件標的</div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 text-slate-500 font-medium w-8">#</th>
              <th className="text-left px-3 py-2 text-slate-500 font-medium">股票</th>
              <th className="text-left px-3 py-2 text-slate-500 font-medium hidden md:table-cell whitespace-nowrap">產業</th>
              {displayDates.map(d => <th key={d} className="text-center px-2 py-2 text-slate-500 font-medium text-xs">{formatDate(d)}</th>)}
              <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs">累計</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs">持有%</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs">評分</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs hidden md:table-cell">{priceDate ? priceDate + ' 收盤' : '收盤'}</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium text-xs hidden md:table-cell">漲跌</th>
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
                      <span className="font-semibold text-slate-800 group-hover:text-primary-600">{row.stock_code}</span>
                      {row.stock_name && <span className="ml-1.5 text-slate-500 text-xs">{row.stock_name}</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs hidden md:table-cell whitespace-nowrap">{row.industry || '—'}</td>
                  {displayDates.map(d => <ChangeCell key={d} value={row.week_changes[d]} />)}
                  <td className="text-center px-2 py-2 text-xs font-bold text-red-600">+{row.total_change.toFixed(2)}</td>
                  <td className="text-center px-2 py-2 text-xs text-slate-700">{row.latest_ratio.toFixed(2)}%</td>
                  <td className="text-center px-2 py-2">
                    <span className={clsx('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-bold', row.score >= 50 ? 'bg-red-100 text-red-700' : row.score >= 30 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600')}>
                      <Star className="w-3 h-3" />{row.score}
                    </span>
                    {row.techBonus > 0 && (
                      <span className="ml-1 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-600" title={row.techSignals.join('、')}>
                        <Zap className="w-3 h-3" />+{row.techBonus}
                      </span>
                    )}
                  </td>
                  <td className="text-center px-2 py-2 text-xs hidden md:table-cell">{rowPrice?.close ? rowPrice.close.toFixed(2) : '—'}</td>
                  <td className={clsx('text-center px-2 py-2 text-xs hidden md:table-cell', rowPrice && rowPrice.change > 0 ? 'text-red-600' : rowPrice && rowPrice.change < 0 ? 'text-green-600' : 'text-slate-400')}>
                    {rowPrice?.change != null ? (rowPrice.change > 0 ? '+' : '') + rowPrice.change.toFixed(2) : '—'}
                  </td>
                  <td className={clsx('text-center px-2 py-2 text-xs hidden md:table-cell', rowPrice && rowPrice.change_pct > 0 ? 'text-red-600' : rowPrice && rowPrice.change_pct < 0 ? 'text-green-600' : 'text-slate-400')}>
                    {rowPrice?.change_pct != null ? (rowPrice.change_pct > 0 ? '+' : '') + rowPrice.change_pct.toFixed(2) + '%' : '—'}
                  </td>
                  <td className="text-center px-2 py-2 text-xs">
                    <div className="flex flex-col items-center gap-0.5">
                      {alert ? <span className={clsx('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap', alert.includes('買進') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600')}>{alert.includes('買進') ? <Flame className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}{alert}</span> : '—'}
                      {row.techSignals.length > 0 && (
                        <span className="text-xs text-blue-500 whitespace-nowrap">{row.techSignals.join('/')}</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}

// ─── 本週主力異動 Panel ───────────────────────────────────────────────────────
function WeeklyChangesPanel({ market }: { market: Market }) {
  const [type, setType] = useState<'increase' | 'decrease'>('increase')
  const { data, isLoading } = useSWR<BHResponse>(
    `${API_BASE}/api/big-holder-changes?market=${market}&limit=5000&sort=latest_change&weeks=6&include_price=1`,
    fetcher, { revalidateOnFocus: false, refreshInterval: 60000 }
  )
  const { data: pricesData } = useSWR<{ trade_date: string; data: Record<string, { close: number; change: number; change_pct: number }> }>(
    `${API_BASE}/api/prices`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 3600000 }
  )
  const priceMap = pricesData?.data || {}
  const priceDate = pricesData?.trade_date ? (pricesData.trade_date.slice(4,6) + '/' + pricesData.trade_date.slice(6,8)) : ''

  const rows: BHRow[] = data?.data || []
  const weekDates = data?.meta?.week_dates || (rows[0]?.week_dates || [])
  const filtered = rows
    .filter(r => shouldInclude(r))
    .sort((a, b) => type === 'increase' ? b.latest_change - a.latest_change : a.latest_change - b.latest_change)
    .slice(0, 20)

  const handleDownload = () => {
    if (!filtered.length) return
    const displayDates = weekDates.slice(-6)
    const headers = ['股票代號', '股票名稱', '市場', '產業', ...displayDates.map(d => formatDate(d)), '累計', '大股東持有%', `${priceDate || ''}收盤`, '漲跌', '漲跌幅']
    const rows = filtered.map(s => {
      const p = priceMap[s.stock_code] || s.price || null
      return [s.stock_code, s.stock_name || '', s.market || '', s.industry || '',
        ...displayDates.map(d => s.week_changes[d] ?? ''),
        s.total_change, s.latest_ratio, p?.close ?? '', p?.change ?? '', p?.change_pct ?? '']
    })
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
      {!isLoading && (
        <HolderPriceTable rows={filtered} weekDates={weekDates} priceMap={priceMap} priceDate={priceDate} emptyMessage="暫無資料" />
      )}
    </div>
  )
}

// ─── 12週籌碼熱力圖 Panel ─────────────────────────────────────────────────────
function HeatmapPanel({ market }: { market: Market }) {
  const { data, isLoading } = useSWR<BHResponse>(
    `${API_BASE}/api/big-holder-changes?market=${market}&limit=50&sort=total_change&weeks=12&include_price=1`,
    fetcher, { revalidateOnFocus: false }
  )
  const { data: pricesData } = useSWR<{ trade_date: string; data: Record<string, { close: number; change: number; change_pct: number }> }>(
    `${API_BASE}/api/prices`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 3600000 }
  )
  const priceDate = pricesData?.trade_date ? (pricesData.trade_date.slice(4,6) + '/' + pricesData.trade_date.slice(6,8)) : ''
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
            <th className="text-center px-2 py-1.5 text-slate-500 font-medium">{priceDate ? priceDate + ' 收盤' : '收盤'}</th>
            <th className="text-center px-2 py-1.5 text-slate-500 font-medium">漲跌%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.stock_code} className="border-t border-slate-100">
              <td className="px-2 py-1 sticky left-0 bg-white">
                <Link href={`/stock/${row.stock_code}`} className="hover:text-primary-600">
                  <span className="font-semibold">{row.stock_code}</span>
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
              <td className="text-center px-2 py-1 text-slate-700">{row.price?.close ? row.price.close.toFixed(2) : '—'}</td>
              <td className={`text-center px-2 py-1 ${row.price && row.price.change_pct > 0 ? 'text-red-600' : row.price && row.price.change_pct < 0 ? 'text-green-600' : 'text-slate-400'}`}>
                {row.price?.change_pct != null ? (row.price.change_pct > 0 ? '+' : '') + row.price.change_pct.toFixed(2) + '%' : '—'}
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
    `${API_BASE}/api/big-holder-changes?market=${market}&limit=5000&sort=total_change&weeks=6&include_price=1`,
    fetcher, { revalidateOnFocus: false }
  )
  const { data: pricesData } = useSWR<{ trade_date: string; data: Record<string, { close: number; change: number; change_pct: number }> }>(
    `${API_BASE}/api/prices`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 3600000 }
  )
  const priceMap = pricesData?.data || {}
  const priceDate = pricesData?.trade_date ? (pricesData.trade_date.slice(4,6) + '/' + pricesData.trade_date.slice(6,8)) : ''

  if (isLoading) return <div className="flex items-center justify-center py-8 text-slate-400 text-sm"><span className="animate-spin mr-2">⟳</span>分析中...</div>
  let rows: BHRow[] = data?.data || []
  rows = rows.filter(r => shouldInclude(r))
  const weekDates = data?.meta?.week_dates || []
  const strongBuy = rows.filter(r => { const rc = weekDates.slice(-3).map(d => r.week_changes[d] ?? 0); return rc.every(v => v > 0) && r.total_change > 3 && r.latest_ratio > 20 }).slice(0, 15)
  const strongSell = rows.filter(r => r.latest_change < -2 && r.total_change < 0).sort((a, b) => a.latest_change - b.latest_change).slice(0, 10)

  const handleDownload = (list: BHRow[], label: string) => {
    if (!list.length) return
    const displayDates = weekDates.slice(-6)
    const headers = ['股票代號', '股票名稱', '市場', '產業', ...displayDates.map(d => formatDate(d)), '累計', '大股東持有%', `${priceDate || ''}收盤`, '漲跌', '漲跌幅']
    const csvRows = list.map(s => {
      const p = priceMap[s.stock_code] || s.price || null
      return [s.stock_code, s.stock_name || '', s.market || '', s.industry || '',
        ...displayDates.map(d => s.week_changes[d] ?? ''),
        s.total_change, s.latest_ratio, p?.close ?? '', p?.change ?? '', p?.change_pct ?? '']
    })
    downloadCSV(`持股背離_${label}_${market}.csv`, headers, csvRows)
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-red-700 flex items-center gap-1.5"><Flame className="w-4 h-4" />大股東持續買進（近3週均增持）</h3>
          {strongBuy.length > 0 && (
            <button onClick={() => handleDownload(strongBuy, '持續買進')} className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-primary-600 hover:bg-slate-50 rounded">
              <Download className="w-3 h-3" />CSV下載
            </button>
          )}
        </div>
        <HolderPriceTable rows={strongBuy} weekDates={weekDates} priceMap={priceMap} priceDate={priceDate} emptyMessage="暫無符合條件標的" />
      </div>
      <div className="border-t border-slate-200 pt-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-green-700 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />大股東減持警示（本週大幅賣出）</h3>
          {strongSell.length > 0 && (
            <button onClick={() => handleDownload(strongSell, '減持警示')} className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-primary-600 hover:bg-slate-50 rounded">
              <Download className="w-3 h-3" />CSV下載
            </button>
          )}
        </div>
        <HolderPriceTable rows={strongSell} weekDates={weekDates} priceMap={priceMap} priceDate={priceDate} emptyMessage="本週無大幅減持標的" />
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
                        <span className="font-semibold text-slate-800">{row.stock_code}</span>
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
