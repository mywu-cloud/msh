export function Footer() {
  return (
    <footer className="border-t border-surface-border bg-white py-6 mt-auto">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-slate-500">
          <p>MSH 股權分散表大股東籌碼分析系統</p>
          <p>資料來源：TDCC 集保股權分散表 · 每週六自動更新</p>
        </div>
      </div>
    </footer>
  )
}
