'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart2, TrendingUp, Database, Calendar } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'

const nav = [
  { href: '/', label: '籌碼分析', icon: BarChart2 },
  { href: '/top-changes', label: '本週異動', icon: TrendingUp },
]

function formatDataDate(dateStr: string): string {
  if (!dateStr) return ''
  if (dateStr.length === 8) {
    return `${dateStr.slice(0, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}`
  }
  if (dateStr.length === 10) {
    return dateStr.replace(/-/g, '/')
  }
  return dateStr
}

export function Header() {
  const pathname = usePathname()
  const [dataDate, setDataDate] = useState<string>('')

  useEffect(() => {
    fetch(`${API_BASE}/api/big-holder-changes?market=twse&limit=1&weeks=1`)
      .then(r => r.json())
      .then(data => {
        const dates: string[] = data?.meta?.week_dates || []
        if (dates.length > 0) {
          setDataDate(dates[dates.length - 1])
        }
      })
      .catch(() => {})
  }, [])

  return (
    <header className="bg-white border-b border-surface-border shadow-sm">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 font-bold text-primary-600">
            <Database className="w-5 h-5" />
            <span>MSH 股權分析 神秘金字塔</span>
          </Link>
          <div className="flex items-center gap-4">
            {dataDate && (
              <div className="flex items-center gap-1 text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                <Calendar className="w-3 h-3" />
                <span>資料日期：{formatDataDate(dataDate)}</span>
              </div>
            )}
            <nav className="flex items-center gap-1">
              {nav.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    pathname === href ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />{label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </header>
  )
}
