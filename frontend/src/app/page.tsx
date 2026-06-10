'use client'

import { useState, useEffect } from 'react'
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
      <option value="">{market === 'twse' ? '全部上市產業' : '全部上櫃產業'}</option>
      {industries.map(ind => <option key={ind} value={ind}>{ind}</option>)}
    </select>
  )
}

function FinMindTokenBar() {
  const [token, setToken] = useState('')
  useEffect(() => { setToken(localStorage.getItem('finmind_token') || '') }, [])
  function save() {
    localStorage.setItem('finmind_token', token.trim())
    window.location.reload()
  }
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-50 border-b border-slate-200 text-xs">
      <span className="text-slate-500 font-medium whitespace-nowrap">FinMind Token:</span>
      <input
        type="password"
        value={token}
        placeholder="輸入 FinMind Token（可選，提高 API 頻率）"
        className="flex-1 max-w-xs px-2 py-1 border border-slate-300 rounded text-xs outline-none focus:border-primary-400"
        onChange={e => setToken(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save() }}
      />
      <button onClick={save} className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">儲存並更新</button>
    </div>
  )
}

type TabId = 'twse' | 'tpex' | 'etf'

const TABS: { id: TabId; label: string; sub: string }[] = [
  { id: 'twse', label: '上市', sub: '台灣證交所' },
  { id: 'tpex', label: '上櫃', sub: '台灣櫃買中心' },
  { id: 'etf', label: 'ETF', sub: '指數型基金' },
]

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>('twse')
  const [twseIndustry, setTwseIndustry] = useState('')
  const [tpexIndustry, setTpexIndustry] = useState('')

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">大股東持有比率週增減排行</h1>
          <p className="text-sm text-slate-500 mt-1">大股東持有比率週增減排行，按累計增幅由高至低排序</p>
        </div>
        <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="搜尋股票代號或名稱..." />
      </div>

      {/* Tab 切換列 */}
      <div className="card p-0 overflow-hidden">
        {/* Tab 按鈕列 */}
        <div className="flex border-b border-surface-border">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                'flex items-center gap-1.5 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-700 bg-primary-50'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50',
              ].join(' ')}
            >
              <span className="font-semibold">{tab.label}</span>
              <span className={['text-xs', activeTab === tab.id ? 'text-primary-400' : 'text-slate-400'].join(' ')}>{tab.sub}</span>
            </button>
          ))}
          {/* 右側集保所標示 + 產業下拉 */}
          <div className="ml-auto flex items-center gap-3 px-4">
            {activeTab === 'twse' && (
              <IndustrySelect market="twse" value={twseIndustry} onChange={setTwseIndustry} />
            )}
            {activeTab === 'tpex' && (
              <IndustrySelect market="tpex" value={tpexIndustry} onChange={setTpexIndustry} />
            )}
            <span className="text-xs text-slate-400">集保所 TDCC</span>
          </div>
        </div>

        <FinMindTokenBar />
        {/* Tab 內容 */}
        {activeTab === 'twse' && (
          <SkillDashboard market="twse" searchQuery={searchQuery} industry={twseIndustry} showEtf={false} etfOnly={false} />
        )}
        {activeTab === 'tpex' && (
          <SkillDashboard market="tpex" searchQuery={searchQuery} industry={tpexIndustry} showEtf={false} etfOnly={false} />
        )}
        {activeTab === 'etf' && (
          <SkillDashboard market="twse" searchQuery={searchQuery} industry="" showEtf={true} etfOnly={true} />
        )}
      </div>
    </div>
  )
}
