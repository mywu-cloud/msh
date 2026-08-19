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
      className="text-sm border border-slate-200 rounded px-2 py-1.5 text-slate-600 bg-white hover:border-slate-300 focus:outline-none focus:border-primary-400"
    >
      <option value="">{market === 'twse' ? '全部上市產業' : '全部上櫃產業'}</option>
      {industries.map(ind => <option key={ind} value={ind}>{ind}</option>)}
    </select>
  )
}

interface ConceptsResp { concepts: string[]; map: Record<string, string[]> }

function ConceptSelect({ market, value, onChange }: {
  market: 'twse' | 'tpex'
  value: string
  onChange: (v: string) => void
}) {
  const { data } = useSWR<ConceptsResp>(
    `${API_BASE}/api/concepts?market=${market}`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const concepts: string[] = data?.concepts || []
  if (concepts.length === 0) return null
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-sm border border-slate-200 rounded px-2 py-1.5 text-slate-600 bg-white hover:border-slate-300 focus:outline-none focus:border-primary-400"
    >
      <option value="">全部概念股</option>
      {concepts.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}

type TabId = 'twse' | 'tpex'

const TABS: { id: TabId; label: string; sub: string }[] = [
  { id: 'twse', label: '上市', sub: '台灣證交所' },
  { id: 'tpex', label: '上櫃', sub: '台灣櫃買中心' },
]

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>('twse')
  const [twseIndustry, setTwseIndustry] = useState('')
  const [tpexIndustry, setTpexIndustry] = useState('')
  const [twseConcept, setTwseConcept] = useState('')
  const [tpexConcept, setTpexConcept] = useState('')

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">大股東持有比率週增減排行</h1>
          <p className="text-sm text-slate-600 mt-1">大股東持有比率週增減排行，按累計增幅由高至低排序</p>
        </div>
        <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="搜尋股票代號或名稱..." />
      </div>

      <div className="card p-0">
        <div className="flex border-b border-surface-border">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                'flex items-center gap-1.5 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-700 bg-primary-50'
                  : 'border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50',
              ].join(' ')}
            >
              <span className="font-semibold">{tab.label}</span>
              <span className={['text-xs', activeTab === tab.id ? 'text-primary-500' : 'text-slate-500'].join(' ')}>{tab.sub}</span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3 px-4">
            {activeTab === 'twse' && (
              <IndustrySelect market="twse" value={twseIndustry} onChange={setTwseIndustry} />
            )}
            {activeTab === 'tpex' && (
              <IndustrySelect market="tpex" value={tpexIndustry} onChange={setTpexIndustry} />
            )}
            {activeTab === 'twse' && (
              <ConceptSelect market="twse" value={twseConcept} onChange={setTwseConcept} />
            )}
            {activeTab === 'tpex' && (
              <ConceptSelect market="tpex" value={tpexConcept} onChange={setTpexConcept} />
            )}
            <span className="text-sm text-slate-500">集保所 TDCC</span>
          </div>
        </div>

        {activeTab === 'twse' && (
          <SkillDashboard market="twse" searchQuery={searchQuery} industry={twseIndustry} showEtf={false} etfOnly={false} concept={twseConcept} />
        )}
        {activeTab === 'tpex' && (
          <SkillDashboard market="tpex" searchQuery={searchQuery} industry={tpexIndustry} showEtf={false} etfOnly={false} concept={tpexConcept} />
        )}
      </div>
    </div>
  )
}
