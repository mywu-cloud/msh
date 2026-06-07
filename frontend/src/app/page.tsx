'use client'

import { useState } from 'react'
import { SkillDashboard } from '@/components/SkillDashboard'
import { SearchBar } from '@/components/SearchBar'

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            大股東持有比率週增減排行
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            大股東持有比率週增減排行，按累計增幅由高至低排序
          </p>
        </div>
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="搜尋股票代號或名稱..."
        />
      </div>

      {/* 上市 */}
      <div className="card p-0 overflow-hidden">
        <div className="border-b border-surface-border px-6 pt-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold text-slate-800">上市</span>
            <span className="text-xs text-slate-400">台灣證交所 TWSE</span>
          </div>
          <div className="text-xs text-slate-400">資料來源：集保所 TDCC</div>
        </div>
        <SkillDashboard market="twse" searchQuery={searchQuery} showEtfInline={false} showIndustryFilter={true} />
      </div>

      {/* 上櫃 */}
      <div className="card p-0 overflow-hidden">
        <div className="border-b border-surface-border px-6 pt-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold text-slate-800">上櫃</span>
            <span className="text-xs text-slate-400">台灣櫃買中心 TPEx</span>
          </div>
          <div className="text-xs text-slate-400">資料來源：集保所 TDCC</div>
        </div>
        <SkillDashboard market="tpex" searchQuery={searchQuery} showEtfInline={false} showIndustryFilter={true} />
      </div>

      {/* ETF */}
      <div className="card p-0 overflow-hidden">
        <div className="border-b border-surface-border px-6 pt-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold text-amber-700">ETF</span>
            <span className="text-xs text-slate-400">指數型基金</span>
          </div>
          <div className="text-xs text-slate-400">資料來源：集保所 TDCC</div>
        </div>
        <SkillDashboard market="all" searchQuery={searchQuery} showEtfInline={true} showIndustryFilter={false} etfOnly={true} />
      </div>
    </div>
  )
}
