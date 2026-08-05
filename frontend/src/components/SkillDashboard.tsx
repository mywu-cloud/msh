'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { TrendingUp, TrendingDown, ChevronUp, ChevronDown, ChevronsUpDown, Download } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())

interface PriceInfo {
  close: number
  change: number
  change_pct: number
}

interface BigHolderRow {
  stock_code: string
  stock_name: string
  market: string
  industry: string
  week_changes: Record<string, number | null>
  total_change: number
  latest_change: number
  latest_ratio: number
  week_dates: string[]
  is_etf?: boolean
    capital_reduction_suspected?: boolean
  price?: PriceInfo | null
}

interface ApiResponse {
  meta: {
    market: string
    week_dates: string[]
    count: number
  }
  data: BigHolderRow[]
}

interface Props {
  market: 'twse' | 'tpex'
  searchQuery: string
  industry?: string
  showEtf?: boolean
  etfOnly?: boolean
}

type SortKey = 'rank' | 'stock_code' | 'industry' | 'total_change' | 'latest_change' | 'latest_ratio' | 'price_close' | 'price_change_pct' | string
type SortDir = 'asc' | 'desc'

function isEtf(code: string, name: string): boolean {
  if (/^0[0-9]/.test(code)) return true
  if (/ETF|指數|基金|債券|黃金|石油|商品/.test(name)) return true
  return false
}

function hasIndustry(row: BigHolderRow): boolean {
  return !!(row.industry && row.industry.trim())
}
function shouldInclude(row: BigHolderRow): boolean {
  if (!hasIndustry(row)) return false
  if (row.industry === 'ETF') return false
  if (row.industry === '存託憑證' || row.industry === '存托憑證') return false
  if (row.industry === '創新板股票' || row.industry === '創新版') return false
  if (row.industry === '已下市' || row.industry === '特別股') return false
  const code = row.stock_code || ''
  if (/^\d{4}[A-Z]/.test(code)) return false
  const name = row.stock_name || ''
    if (name.endsWith('-創') || name.endsWith('-KY創') || name.endsWith('-特')) return false
  if (/[甲乙丙丁戊己庚辛壬癸][特]$/.test(name)) return false
  return true
}


function formatDate(d: string): string {
  if (d.length === 8) return d.slice(4, 6) + '/' + d.slice(6, 8)
  if (d.length === 10) return d.slice(5, 7) + '/' + d.slice(8, 10)
  return d
}

function ChangeCell({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <td className="text-center text-slate-700 px-2 py-2 text-xs">—</td>
  if (value === 0) return <td className="text-center text-slate-600 px-2 py-2 text-xs">0.00</td>
  const isPos = value > 0
  return <td className={`text-center px-2 py-2 text-xs font-medium ${isPos ? 'text-red-600' : 'text-green-600'}`}>
    {isPos ? '+' : ''}{value.toFixed(2)}
  </td>
}

function PriceCell({ price }: { price?: PriceInfo | null }) {
  if (!price || !price.close) {
    const notice = "近期無成交價，可能是減資換股、暫停交易或資料來源限制所致，實際狀況請以公開資訊觀測站公告為準"
    return <><td className="text-center px-2 py-2 text-xs text-slate-600 whitespace-nowrap" style={{minWidth:'100px'}}><span title={notice} className="cursor-help border-b border-dotted border-slate-400">— <span className="text-amber-500">⚠</span></span></td><td className="text-center px-2 py-2 text-xs text-slate-600 whitespace-nowrap" style={{minWidth:'76px'}}>—</td><td className="text-center px-2 py-2 text-xs text-slate-600 whitespace-nowrap" style={{minWidth:'88px'}}>—</td></>
  }
  const isPos = price.change > 0
  const isNeg = price.change < 0
  const cls = isPos ? 'text-red-600' : isNeg ? 'text-green-600' : 'text-slate-700'
  return <>
    <td className={`text-center px-2 py-2 text-xs font-medium whitespace-nowrap ${cls}`} style={{minWidth:'100px'}}>{price.close.toFixed(2)}</td>
    <td className={`text-center px-2 py-2 text-xs font-medium whitespace-nowrap ${cls}`} style={{minWidth:'76px'}}>{isPos ? '+' : ''}{price.change.toFixed(2)}</td>
    <td className={`text-center px-2 py-2 text-xs font-medium whitespace-nowrap ${cls}`} style={{minWidth:'88px'}}>{isPos ? '+' : ''}{price.change_pct.toFixed(2)}%</td>
  </>
}

function SortIcon({ col, sortKey, sortDir }: { col: string; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 inline ml-0.5 text-slate-600" />
  if (sortDir === 'desc') return <ChevronDown className="w-3 h-3 inline ml-0.5 text-primary-600" />
  return <ChevronUp className="w-3 h-3 inline ml-0.5 text-primary-600" />
}

// ─── CSV Download Helper ──────────────────────────────────────────────────────
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

function StockTable({ rows, weekDates, startIndex, sortKey, sortDir, onSort, hasPrice, priceMap = {}, priceDate = '' }: {
  rows: BigHolderRow[]
  weekDates: string[]
  startIndex: number
  sortKey: SortKey
  sortDir: SortDir
  onSort: (col: SortKey) => void
  hasPrice: boolean
  priceMap?: Record<string, { close: number; change: number; change_pct: number }>
  priceDate?: string
}) {
  const thClass = (col: SortKey) =>
    `text-center px-2 py-2 text-slate-700 font-medium whitespace-nowrap cursor-pointer hover:text-primary-600 select-none ${sortKey === col ? 'text-primary-600' : ''}`

  return (
    <div className="overflow-x-auto">
      <table className="text-sm" style={{minWidth:'1180px', tableLayout:'auto'}}>
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-3 py-2 text-slate-700 font-medium w-8 cursor-pointer hover:text-primary-600 select-none" onClick={() => onSort('rank')}>
              # <SortIcon col="rank" sortKey={sortKey} sortDir={sortDir} />
            </th>
            <th className="text-left px-3 py-2 text-slate-700 font-medium cursor-pointer hover:text-primary-600 select-none" onClick={() => onSort('stock_code')}>
              股票代號/名稱 <SortIcon col="stock_code" sortKey={sortKey} sortDir={sortDir} />
            </th>
            <th className="text-left px-3 py-2 text-slate-700 font-medium hidden md:table-cell cursor-pointer hover:text-primary-600 select-none whitespace-nowrap" onClick={() => onSort('industry')}>
              類別 <SortIcon col="industry" sortKey={sortKey} sortDir={sortDir} />
            </th>
            {weekDates.map(d => (
              <th key={d} className={thClass(d)} onClick={() => onSort(d)}>
                {formatDate(d)} <SortIcon col={d} sortKey={sortKey} sortDir={sortDir} />
              </th>
            ))}
            <th className={thClass('total_change')} onClick={() => onSort('total_change')}>
              <span className="flex items-center justify-center gap-1"><TrendingUp className="w-3 h-3" />累計</span>
              <SortIcon col="total_change" sortKey={sortKey} sortDir={sortDir} />
            </th>
            <th className={thClass('latest_ratio')} onClick={() => onSort('latest_ratio')}>
              上週持有%<SortIcon col="latest_ratio" sortKey={sortKey} sortDir={sortDir} />
            </th>
            {hasPrice && <>
              <th className={thClass('price_close') + ' min-w-[100px]'} onClick={() => onSort('price_close')}>{priceDate ? priceDate + ' 收盤' : '收盤'}<SortIcon col="price_close" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={thClass('price_change') + ' min-w-[76px]'} onClick={() => onSort('price_change')}>漲跌<SortIcon col="price_change" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={thClass('price_change_pct') + ' min-w-[88px]'} onClick={() => onSort('price_change_pct')}>漲跌幅<SortIcon col="price_change_pct" sortKey={sortKey} sortDir={sortDir} /></th>
            </>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, idx) => {
            const isTotalPos = row.total_change > 0
            const isTotalNeg = row.total_change < 0
            return (
              <tr key={row.stock_code} className="hover:bg-slate-50 transition-colors">
                <td className="px-3 py-2 text-slate-600 text-xs text-center">{startIndex + idx + 1}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link href={`/stock/${row.stock_code}`} className="flex items-center gap-2 group">
                    <div>
                      <span className="font-semibold text-primary-600">{row.stock_code}</span>
                      {row.stock_name && <span className="ml-1.5 text-slate-800 text-xs">{row.stock_name}</span>}
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-700 text-xs hidden md:table-cell whitespace-nowrap">{row.industry || '—'}</td>
                {weekDates.map(d => <ChangeCell key={d} value={row.week_changes[d]} />)}
                <td className={`text-center px-2 py-2 text-xs font-bold ${isTotalPos ? 'text-red-600' : isTotalNeg ? 'text-green-600' : 'text-slate-600'}`}>
                  {row.total_change > 0 ? '+' : ''}{row.total_change.toFixed(2)}
                </td>
                <td className="text-center px-2 py-2 text-slate-700 text-xs font-medium">{row.latest_ratio.toFixed(2)}%{row.capital_reduction_suspected && <span title="疑似減資或股權結構調整：集保股權分散表顯示總股數或總股東人數與前一週相比出現異常變化，本欄位數值暫不具參考性" className="ml-1 text-amber-500 cursor-help">※</span>}</td>
                {hasPrice && <PriceCell price={priceMap[row.stock_code] || row.price} />}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function SkillDashboard({ market, searchQuery, industry = '', showEtf = true, etfOnly = false }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('total_change')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const { data, error, isLoading } = useSWR<ApiResponse>(
    `${API_BASE}/api/big-holder-changes?market=${market}&limit=5000&sort=total_change&weeks=6&include_price=1`,
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

  function handleSort(col: SortKey) {
    if (sortKey === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(col); setSortDir('desc') }
  }

  if (isLoading) return (
    <div className="p-8 text-center text-slate-600">
      <div className="animate-spin w-8 h-8 border-2 border-primary-300 border-t-primary-600 rounded-full mx-auto mb-4" />
      <p>載入大股東籌碼資料中...</p>
    </div>
  )

  if (error || !data) return (
    <div className="p-8 text-center text-slate-600">
      <TrendingDown className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="font-medium">暫無資料</p>
      <p className="text-sm mt-1">請確認 API 服務正常</p>
    </div>
  )

  const rows: BigHolderRow[] = (Array.isArray(data) ? data : (data.data || [])).map(r => ({
    ...r, is_etf: isEtf(r.stock_code, r.stock_name || '')
  }))
  const weekDates: string[] = data.meta?.week_dates || (rows[0]?.week_dates || [])
  const hasPrice = Object.keys(priceMap).length > 0 || rows.some(r => r.price && r.price.close)

  const filtered = rows.filter(r => {
    // 移除非產業類（類別空白）的項目
    if (!shouldInclude(r)) return false
    if (etfOnly) return r.is_etf === true
    if (!showEtf && r.is_etf) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!r.stock_code.includes(q) && !(r.stock_name || '').includes(q) && !(r.industry || '').toLowerCase().includes(q)) return false
    }
    if (industry && (r.industry || '') !== industry) return false
    return true
  })

  function sortRows(arr: BigHolderRow[]) {
    return [...arr].sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0
      if (sortKey === 'rank' || sortKey === 'total_change') { av = a.total_change; bv = b.total_change }
      else if (sortKey === 'stock_code') { av = a.stock_code; bv = b.stock_code }
      else if (sortKey === 'industry') { av = a.industry || ''; bv = b.industry || '' }
      else if (sortKey === 'latest_change') { av = a.latest_change; bv = b.latest_change }
      else if (sortKey === 'latest_ratio') { av = a.latest_ratio; bv = b.latest_ratio }
      else if (sortKey === 'price_close') { av = a.price?.close ?? 0; bv = b.price?.close ?? 0 }
      else if (sortKey === 'price_change') { av = a.price?.change ?? 0; bv = b.price?.change ?? 0 }
      else if (sortKey === 'price_change_pct') { av = a.price?.change_pct ?? 0; bv = b.price?.change_pct ?? 0 }
      else if (weekDates.includes(sortKey)) { av = a.week_changes[sortKey] ?? 0; bv = b.week_changes[sortKey] ?? 0 }
      if (typeof av === 'string' && typeof bv === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      const diff = (av as number) - (bv as number)
      return sortDir === 'asc' ? diff : -diff
    })
  }

  const sortedRows = sortRows(filtered)

  const handleDownload = () => {
    const headers = ['排名', '股票代號', '股票名稱', '類別', ...weekDates.map(d => formatDate(d)), '累計增幅', '上週持有%', ...(hasPrice ? ['收盤價', '漲跌', '漲跌%'] : [])]
    const csvRows = sortedRows.map((row, idx) => [
      idx + 1, row.stock_code, row.stock_name || '', row.industry || '',
      ...weekDates.map(d => row.week_changes[d] ?? ''),
      row.total_change, row.latest_ratio,
      ...(hasPrice ? [row.price?.close ?? '', row.price?.change ?? '', row.price?.change_pct ?? ''] : [])
    ])
    const tabName = etfOnly ? 'ETF' : market === 'twse' ? '上市' : '上櫃'
    downloadCSV(`籌碼分析_${tabName}_${new Date().toISOString().slice(0,10)}.csv`, headers, csvRows)
  }

  if (sortedRows.length === 0) return <div className="p-8 text-center text-slate-600"><p>找不到符合條件的股票</p></div>

  return (
    <div className="overflow-x-auto" style={{minWidth:0}}>
      {/* Download toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50">
        <span className="text-xs text-slate-700">共 {sortedRows.length} 檔</span>
        <button onClick={handleDownload} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-primary-600 hover:bg-white rounded border border-slate-200 hover:border-primary-300 transition-colors">
          <Download className="w-3.5 h-3.5" />CSV 下載
        </button>
      </div>
      {sortedRows.some(r => r.capital_reduction_suspected) && (
                <div className="px-4 py-1.5 text-xs text-amber-600 bg-amber-50 border-b border-amber-100">
                            ※ 疑似減資或股權結構調整期間，集保股權分散表總股數或總股東人數與前一週相比出現異常變化，「上週持有%」及相關累計變動數值暫不具參考性，請以公開資訊觀測站公告為準
                </div>
              )}
      <StockTable rows={sortedRows} weekDates={weekDates} startIndex={0} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} hasPrice={hasPrice} priceMap={priceMap} priceDate={priceDate} />
    </div>
  )
}
