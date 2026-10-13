export function Footer() {
  return (
    <footer className="border-t border-surface-border bg-surface py-5 sm:py-6 mt-auto">
      <div className="mx-auto px-3 sm:px-4 max-w-[1300px]">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-1 sm:gap-2 text-xs sm:text-sm text-slate-500 text-center sm:text-left">
          <p>MSH 股權分散表大股東籌碼分析系統</p>
          <p>資料來源：TDCC 集保股權分散表 · 每週六自動更新</p>
        </div>
      </div>
    </footer>
  )
}
