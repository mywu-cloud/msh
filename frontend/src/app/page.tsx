'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { SkillDashboard } from '@/components/SkillDashboard'
import { SearchBar } from '@/components/SearchBar'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())

interface IndustriesResp { industries: string[] }

function IndustrySelect({ market, value, onChange }: {
  market: 'twse' | 'tpex'
  value: string
  onChange: (v: string) => void
}) {
  const { data } = useSWR<IndustriesResp>(
    `${API_BASE}/api/industries?market=${market}`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const industries: string[] = data?.industries || []
  if (industries.length === 0) return null
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-xs border border-slate-200 rounded px-2 py-1.5 text-slate-600 bg-white hover:border-slate-300 focus:outline-none focus:border-primary-400"
    >
      <option value="">全部產業</option>
      {industries.map(ind => <option key={ind} value={ind}>{ind}</option>)}
    </select>
  )
}

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [twseIndustry, setTwseIndustry] = useState('')
  const [tpexIndustry, setTpexIndustry] = useState('')

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">大股東持有比率週增減排行</h1>
          <p className="text-sm text-slate-500 mt-1">大股東持有比率週增減排行，按累計增幅由高至低排序</p>
        </div>
        <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="搜尋股票代號或名稱..." />
      </div>

      {/* 上市 */}
      <div className="card p-0 overflow-hidden">
        <div className="border-b border-surface-border px-6 pt-4 pb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <span className="text-base font-semibold text-slate-800">上市</span>
              <span className="ml-2 text-xs text-slate-400">台灣證交所 TWSE</span>
            </div>
            <IndustrySelect market="twse" value={twseIndustry} onChange={setTwseIndustry} />
          </div>
          <div className="text-xs text-slate-400">資料來源：集保所 TDCC</div>
        </div>
        <SkillDashboard market="twse" searchQuery={searchQuery} industry={twseIndustry} showEtf={false} etfOnly={false} />
      </div>

      {/* 上櫃 */}
      <div className="card p-0 overflow-hidden">
        <div className="border-b border-surface-border px-6 pt-4 pb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <span className="text-base font-semibold text-slate-800">上櫃</span>
              <span className="ml-2 text-xs text-slate-400">台灣櫃買中心 TPEx</span>
            </div>
            <IndustrySelect market="tpex" value={tpexIndustry} onChange={setTpexIndustry} />
          </div>
          <div className="text-xs text-slate-400">資料來源：集保所 TDCC</div>
        </div>
        <SkillDashboard market="tpex" searchQuery={searchQuery} industry={tpexIndustry} showEtf={false} etfOnly={false} />
      </div>

      {/* ETF */}
      <div className="card p-0 overflow-hidden">
        <div className="border-b border-surface-border px-6 pt-4 pb-3 flex items-center justify-between bg-amber-50">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-amber-800">ETF</span>
            <span className="text-xs text-slate-400">指數型基金</span>
          </div>
          <div className="text-xs text-slate-400">資料來源：集保所 TDCC</div>
        </div>
        <SkillDashboard market="twse" searchQuery={searchQuery} industry="" showEtf={true} etfOnly={true} />
      </div>
    </div>
  )
}
