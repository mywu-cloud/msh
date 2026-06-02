'use client'

  import Link from 'next/link'
import { usePathname } from 'next/navigation'
    import { BarChart2, TrendingUp, Search, RefreshCw } from 'lucide-react'
    import clsx from 'clsx'

const NAV_ITEMS = [
{ href: '/', label: '起漲儀表板', icon: TrendingUp },
{ href: '/distribution', label: '股權分散表', icon: BarChart2 },
{ href: '/top-changes', label: '籌碼異動', icon: RefreshCw },
{ href: '/search', label: '個股查詢', icon: Search },
]

export function Header() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
      <div className="container mx-auto px-4 max-w-[1400px]">
        <div className="flex items-center justify-between h-14">
{/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 bg-primary-700 rounded-lg flex items-center justify-center">
              <TrendingUp size={16} className="text-white" />
            </div>
            <div>
              <span className="font-bold text-base text-slate-900 tracking-tight">
                MSH
              </span>
              <span className="text-xs text-slate-400 ml-1 hidden sm:inline">
                股權分散表分析
              </span>
            </div>
          </Link>

{/* Navigation */}
          <nav className="flex items-center gap-1">
{NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={clsx(
                  'nav-link hidden sm:flex items-center gap-1.5',
                  pathname === href && 'active'
                )}
              >
                <Icon size={13} />
                <span>{label}</span>
              </Link>
            ))}
          </nav>

{/* Data freshness indicator */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="hidden sm:inline">每週六更新</span>
            </div>
          </div>
        </div>

{/* Mobile Nav */}
        <div className="flex sm:hidden border-t border-slate-100 overflow-x-auto pb-1">
{NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-1 px-3 py-2 text-xs whitespace-nowrap',
                pathname === href
                  ? 'text-primary-700 font-semibold border-b-2 border-primary-700'
                  : 'text-slate-500'
              )}
            >
              <Icon size={12} />
{label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  )
}
