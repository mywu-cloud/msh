import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { themeInitScript } from '@/lib/theme-script'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b111d' },
  ],
}

export const metadata: Metadata = {
  title: 'MSH 股權分散表大股東籌碼分析',
  description: '台灣股市大股東籌碼追蹤，自動篩選起漲潛力個股。整合 TDCC 集保數據，提供上市上櫃各 TOP 20 起漲標的。',
  keywords: '股權分散表,大股東籌碼,台股,起漲,集保,TDCC',
  openGraph: {
    title: 'MSH 股權分散表大股東籌碼分析',
    description: '台股大股東籌碼集中度分析，智能篩選起漲潛力標的',
    locale: 'zh_TW',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className="bg-surface-bg min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 mx-auto w-full px-3 sm:px-4 py-4 sm:py-6 max-w-[1300px]">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  )
}
