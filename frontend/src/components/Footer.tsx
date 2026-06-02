export function Footer() {
    const year = new Date().getFullYear()

  return (
          <footer className="border-t border-slate-200 bg-white mt-auto">
            <div className="container mx-auto px-4 max-w-[1400px] py-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-600">MSH</span>
                  <span>股權分散表大股東籌碼分析系統</span>
                </div>
                <div className="flex items-center gap-4">
                  <span>資料來源：TDCC 集保公司 / TWSE 證交所</span>
                  <span>©{year}</span>
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-300 text-center">
                本網站數據僅供參考，不構成投資建議。投資有風險，請自行判斷。
              </div>
            </div>
          </footer>
        )
      }
