'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart2, TrendingUp, Database, Calendar, Menu, X } from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'

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

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(href + '/')
}

export function Header() {
  const pathname = usePathname()
  const [dataDate, setDataDate] = useState<string>('')
  const [menuOpen, setMenuOpen] = useState(false)

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

  // Close the mobile menu on navigation
  useEffect(() => { setMenuOpen(false) }, [pathname])

  return (
    <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur border-b border-surface-border shadow-sm">
      <div className="mx-auto px-3 sm:px-4 max-w-[1300px]">
        <div className="flex items-center justify-between gap-2 h-14 md:h-16">
          <Link href="/" className="flex items-center gap-2 font-bold text-primary-600 min-w-0">
            <Database className="w-5 h-5 flex-shrink-0" />
            <span className="truncate">
              MSH 股權分析<span className="hidden sm:inline"> 神秘金字塔</span>
            </span>
          </Link>

          {/* Desktop / tablet */}
          <div className="hidden md:flex items-center gap-3">
            {dataDate && (
              <div className="flex items-center gap-1 text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-200 whitespace-nowrap">
                <Calendar className="w-3 h-3" />
                <span>資料日期：{formatDataDate(dataDate)}</span>
              </div>
            )}
            <nav className="flex items-center gap-1">
              {nav.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive(pathname, href) ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />{label}
                </Link>
              ))}
            </nav>
            <ThemeToggle />
          </div>

          {/* Mobile */}
          <div className="flex md:hidden items-center gap-1.5">
            {dataDate && (
              <span className="flex items-center gap-1 text-xs text-slate-500 whitespace-nowrap">
                <Calendar className="w-3 h-3" />{formatDataDate(dataDate).slice(5)}
              </span>
            )}
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              aria-label={menuOpen ? '關閉選單' : '開啟選單'}
              aria-expanded={menuOpen}
              className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
            >
              {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {menuOpen && (
        <nav className="md:hidden border-t border-surface-border bg-surface px-3 py-2 space-y-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-base font-medium ${
                isActive(pathname, href) ? 'bg-primary-50 text-primary-700' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />{label}
            </Link>
          ))}
          {dataDate && (
            <p className="px-3 pt-1 pb-1 text-xs text-slate-500">資料日期：{formatDataDate(dataDate)}</p>
          )}
        </nav>
      )}
    </header>
  )
}
