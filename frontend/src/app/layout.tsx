import type { Metadata } from 'next'
import './globals.css'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'

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
    <html lang="zh-TW">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className="bg-surface-bg min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  )
}
