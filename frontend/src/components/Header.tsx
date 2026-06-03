'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart2, TrendingUp, Database } from 'lucide-react'

const nav = [
  { href: '/', label: '籌碼分析', icon: BarChart2 },
  { href: '/top-changes', label: '本週異動', icon: TrendingUp },
]

export function Header() {
  const pathname = usePathname()
  return (
    <header className="bg-white border-b border-surface-border shadow-sm">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 font-bold text-primary-600">
            <Database className="w-5 h-5" />
            <span>MSH 股權分析</span>
          </Link>
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
    </header>
  )
}
