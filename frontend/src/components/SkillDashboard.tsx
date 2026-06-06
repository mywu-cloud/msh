'use client'

import { useState, useRef } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { TrendingUp, TrendingDown, ChevronUp, ChevronDown, ChevronsUpDown, Upload, X, CheckCircle, AlertCircle } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())

interface BigHolderRow {
  stock_code: string
  stock_name: string
  market: string
  industry: string
  week_changes: Record<string, number>
  total_change: number
  latest_change: number
  latest_ratio: number
  week_dates: string[]
  is_etf?: boolean
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
  market: 'all' | 'twse' | 'tpex'
  searchQuery: string
}

type SortKey = 'rank' | 'stock_code' | 'industry' | 'total_change' | 'latest_change' | 'latest_ratio' | string
type SortDir = 'asc' | 'desc'

function isEtf(code: string, name: string): boolean {
  if (/^0[0-9]/.test(code)) return true
  if (/ETF|指數|基金|債券|黃金|石油|商品/.test(name)) return true
  return false
}

function formatDate(d: string): string {
  if (d.length === 8) return d.slice(4, 6) + '/' + d.slice(6, 8)
  if (d.length === 10) return d.slice(5, 7) + '/' + d.slice(8, 10)
  return d
}

function ChangeCell({ value }: { value: number }) {
  if (value === 0) return <td className="text-center text-slate-400 px-2 py-2 text-xs">—</td>
  const isPos = value > 0
  return (
    <td className={`text-center px-2 py-2 text-xs font-medium ${isPos ? 'text-red-600' : 'text-green-600'}`}>
      {isPos ? '+' : ''}{value.toFixed(2)}
    </td>
  )
}

function MarketBadge({ market }: { market: string }) {
  if (market === 'twse') return <span className="text-xs px-1 py-0.5 rounded bg-blue-50 text-blue-600">上市</span>
  if (market === 'tpex') return <span className="text-xs px-1 py-0.5 rounded bg-green-50 text-green-600">上櫃</span>
  return null
}

function SortIcon({ col, sortKey, sortDir }: { col: string; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 inline ml-0.5 text-slate-400" />
  if (sortDir === 'desc') return <ChevronDown className="w-3 h-3 inline ml-0.5 text-primary-600" />
  return <ChevronUp className="w-3 h-3 inline ml-0.5 text-primary-600" />
}

interface UploadStatus {
  type: 'idle' | 'loading' | 'success' | 'error'
  message: string
}

function CsvUploadPanel({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<UploadStatus>({ type: 'idle', message: '' })
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setStatus({ type: 'loading', message: '上傳中...' })
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('source', 'tdcc')
      const res = await fetch(`${API_BASE}/api/upload-csv`, { method: 'POST', body: fd })
      const json = await res.json()
      if (res.ok && json.success) {
        setStatus({ type: 'success', message: json.message || '上傳成功！' })
        onSuccess()
      } else {
        setStatus({ type: 'error', message: json.error || '上傳失敗' })
      }
    } catch {
      setStatus({ type: 'error', message: '網路錯誤，請稍後再試' })
    }
  }

  return (
    <div className="border-b border-surface-border px-4 py-2 bg-slate-50 flex items-center gap-3 flex-wrap">
      <button
        onClick={() => { setOpen(!open); setStatus({ type: 'idle', message: '' }) }}
        className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-primary-600 px-3 py-1.5 rounded border border-slate-300 hover:border-primary-400 bg-white transition-colors"
      >
        <Upload className="w-3.5 h-3.5" />
        手動上傳 TDCC CSV
      </button>
      {open && (
        <form onSubmit={handleUpload} className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="text-xs text-slate-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border file:border-slate-300 file:text-xs file:bg-white file:text-slate-600 hover:file:bg-slate-50"
          />
          <button
            type="submit"
            disabled={status.type === 'loading'}
            className="text-xs px-3 py-1.5 rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {status.type === 'loading' ? '上傳中...' : '確認上傳'}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </form>
      )}
      {status.type === 'success' && (
        <span className="flex items-center gap-1 text-xs text-green-600">
          <CheckCircle className="w-3.5 h-3.5" />{status.message}
        </span>
      )}
      {status.type === 'error' && (
        <span className="flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="w-3.5 h-3.5" />{status.message}
        </span>
      )}
      <span className="text-xs text-slate-400 ml-auto">
        請從<a href="https://www.tdcc.com.tw/portal/zh/smWeb/qryStock" target="_blank" rel="noopener" className="text-blue-500 hover:underline mx-1">集保所</a>下載 CSV，格式：日期/證券代號/持股分級/人數/股數/比例
      </span>
    </div>
  )
}

function StockTable({
  rows,
  weekDates,
  showMarket,
  startIndex,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: BigHolderRow[]
  weekDates: string[]
  showMarket: boolean
  startIndex: number
  sortKey: SortKey
  sortDir: SortDir
  onSort: (col: SortKey) => void
}) {
  const thClass = (col: SortKey) =>
    `text-center px-2 py-2 text-slate-500 font-medium whitespace-nowrap cursor-pointer hover:text-primary-600 select-none ${sortKey === col ? 'text-primary-600' : ''}`

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-3 py-2 text-slate-500 font-medium w-8 cursor-pointer hover:text-primary-600 select-none" onClick={() => onSort('rank')}>
              # <SortIcon col="rank" sortKey={sortKey} sortDir={sortDir} />
            </th>
            <th className="text-left px-3 py-2 text-slate-500 font-medium cursor-pointer hover:text-primary-600 select-none" onClick={() => onSort('stock_code')}>
              股票代號/名稱 <SortIcon col="stock_code" sortKey={sortKey} sortDir={sortDir} />
            </th>
            <th className="text-left px-3 py-2 text-slate-500 font-medium hidden md:table-cell cursor-pointer hover:text-primary-600 select-none" onClick={() => onSort('industry')}>
              類別 <SortIcon col="industry" sortKey={sortKey} sortDir={sortDir} />
            </th>
            {weekDates.map(d => (
              <th key={d} className={thClass(d)} onClick={() => onSort(d)}>
                {formatDate(d)} <SortIcon col={d} sortKey={sortKey} sortDir={sortDir} />
              </th>
            ))}
            <th className={thClass('total_change')} onClick={() => onSort('total_change')}>
              <span className="flex items-center justify-center gap-1">
                <TrendingUp className="w-3 h-3" />累計
              </span>
              <SortIcon col="total_change" sortKey={sortKey} sortDir={sortDir} />
            </th>
            <th className={thClass('latest_ratio')} onClick={() => onSort('latest_ratio')}>
              上週持有%<SortIcon col="latest_ratio" sortKey={sortKey} sortDir={sortDir} />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, idx) => {
            const isTotalPos = row.total_change > 0
            const isTotalNeg = row.total_change < 0
            return (
              <tr key={row.stock_code} className="hover:bg-slate-50 transition-colors">
                <td className="px-3 py-2 text-slate-400 text-xs text-center">{startIndex + idx + 1}</td>
                <td className="px-3 py-2">
                  <Link href={`/stock/${row.stock_code}`} className="flex items-center gap-2 group">
                    <div>
                      <span className="font-mono font-semibold text-slate-800 group-hover:text-primary-600">
                        {row.stock_code}
                      </span>
                      {row.stock_name && (
                        <span className="ml-1.5 text-slate-600 text-xs">{row.stock_name}</span>
                      )}
                      {showMarket && (
                        <span className="ml-1"><MarketBadge market={row.market} /></span>
                      )}
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs hidden md:table-cell">
                  {row.industry || '—'}
                </td>
                {weekDates.map(d => (
                  <ChangeCell key={d} value={row.week_changes[d] ?? 0} />
                ))}
                <td className={`text-center px-2 py-2 text-xs font-bold ${
                  isTotalPos ? 'text-red-600' : isTotalNeg ? 'text-green-600' : 'text-slate-400'
                }`}>
                  {row.total_change > 0 ? '+' : ''}{row.total_change.toFixed(2)}
                </td>
                <td className="text-center px-2 py-2 text-slate-700 text-xs font-medium">
                  {row.latest_ratio.toFixed(2)}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function SkillDashboard({ market, searchQuery }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('total_change')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showEtf, setShowEtf] = useState(false)

  const { data, error, isLoading, mutate } = useSWR<ApiResponse>(
    `${API_BASE}/api/big-holder-changes?market=${market}&limit=5000&sort=total_change&weeks=6`,
    fetcher,
    { revalidateOnFocus: false }
  )

  function handleSort(col: SortKey) {
    if (sortKey === col) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(col)
      setSortDir('desc')
    }
  }

  if (isLoading) return (
    <div className="p-8 text-center text-slate-400">
      <div className="animate-spin w-8 h-8 border-2 border-primary-300 border-t-primary-600 rounded-full mx-auto mb-4" />
      <p>載入大股東籌碼資料中...</p>
    </div>
  )

  if (error || !data) return (
    <div className="p-8 text-center text-slate-400">
      <TrendingDown className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="font-medium">暫無資料</p>
      <p className="text-sm mt-1">請確認 API 服務正常，或上傳 TDCC CSV 匯入資料</p>
    </div>
  )

  const rows: BigHolderRow[] = (Array.isArray(data) ? data : (data.data || [])).map(r => ({
    ...r,
    is_etf: isEtf(r.stock_code, r.stock_name || '')
  }))
  const weekDates: string[] = data.meta?.week_dates || (rows[0]?.week_dates || [])

  const filtered = rows.filter(r => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!r.stock_code.includes(q) && !(r.stock_name || '').includes(q) && !(r.industry || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const stocks = filtered.filter(r => !r.is_etf)
  const etfs = filtered.filter(r => r.is_etf)

  function sortRows(arr: BigHolderRow[]) {
    return [...arr].sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0
      if (sortKey === 'rank' || sortKey === 'total_change') { av = a.total_change; bv = b.total_change }
      else if (sortKey === 'stock_code') { av = a.stock_code; bv = b.stock_code }
      else if (sortKey === 'industry') { av = a.industry || ''; bv = b.industry || '' }
      else if (sortKey === 'latest_change') { av = a.latest_change; bv = b.latest_change }
      else if (sortKey === 'latest_ratio') { av = a.latest_ratio; bv = b.latest_ratio }
      else if (weekDates.includes(sortKey)) { av = a.week_changes[sortKey] ?? 0; bv = b.week_changes[sortKey] ?? 0 }
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      const diff = (av as number) - (bv as number)
      return sortDir === 'asc' ? diff : -diff
    })
  }

  const sortedStocks = sortRows(stocks)
  const sortedEtfs = sortRows(etfs)

  return (
    <div>
      <CsvUploadPanel onSuccess={() => mutate()} />
      <div className="overflow-hidden">
        <StockTable
          rows={sortedStocks}
          weekDates={weekDates}
          showMarket={market === 'all'}
          startIndex={0}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
        />
        <div className="border-t border-slate-200 mt-2">
          <button
            className="w-full flex items-center justify-between px-4 py-2 bg-amber-50 hover:bg-amber-100 transition-colors text-sm font-medium text-amber-800"
            onClick={() => setShowEtf(!showEtf)}
          >
            <span className="flex items-center gap-2">
              ETF / 指數型基金
              <span className="text-xs text-amber-600 font-normal">（{sortedEtfs.length} 檔）</span>
            </span>
            {showEtf ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showEtf && (
            <StockTable
              rows={sortedEtfs}
              weekDates={weekDates}
              showMarket={market === 'all'}
              startIndex={0}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />
          )}
        </div>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-slate-400">
            <p>找不到符合條件的股票</p>
          </div>
        )}
      </div>
    </div>
  )
}
