'use client'

import { useState, useRef } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'

interface UploadResult {
  success: boolean
  message: string
  date?: string
  inserted?: number
  skipped?: number
  errors?: number
  error?: string
}

export default function UploadPage() {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState<Array<{ file: string; result: UploadResult }>>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...selected.filter(f => !names.has(f.name))]
    })
    e.target.value = ''
  }

  const removeFile = (name: string) => setFiles(prev => prev.filter(f => f.name !== name))

  const handleUpload = async () => {
    if (!files.length) return
    setUploading(true)
    setResults([])
    const newResults: Array<{ file: string; result: UploadResult }> = []

    for (const file of files) {
      const form = new FormData()
      form.append('file', file)
      form.append('source', 'tdcc')
      try {
        const res = await fetch(`${API_BASE}/api/upload-csv`, { method: 'POST', body: form })
        const json: UploadResult = await res.json()
        newResults.push({ file: file.name, result: json })
      } catch (e) {
        newResults.push({ file: file.name, result: { success: false, message: '', error: String(e) } })
      }
    }

    setResults(newResults)
    setUploading(false)
    // Clear files that succeeded
    const failed = new Set(newResults.filter(r => !r.result.success).map(r => r.file))
    setFiles(prev => prev.filter(f => failed.has(f.name)))
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">上傳 TDCC CSV</h1>
        <p className="text-sm text-slate-500 mt-1">從集保所下載的大股東持有比率 CSV，可一次選取多個檔案</p>
      </div>

      {/* Drop zone */}
      <div
        className="card border-2 border-dashed border-slate-300 hover:border-primary-400 transition-colors cursor-pointer p-8 text-center"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          const dropped = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.csv'))
          setFiles(prev => {
            const names = new Set(prev.map(f => f.name))
            return [...prev, ...dropped.filter(f => !names.has(f.name))]
          })
        }}
      >
        <input ref={inputRef} type="file" accept=".csv" multiple className="hidden" onChange={handleFileChange} />
        <div className="text-4xl mb-3">📂</div>
        <p className="text-slate-600 font-medium">點擊選取 CSV 檔案，或拖曳到此處</p>
        <p className="text-xs text-slate-400 mt-1">支援多檔案同時上傳（.csv）</p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-surface-border text-sm font-medium text-slate-700">
            已選取 {files.length} 個檔案
          </div>
          <ul className="divide-y divide-surface-border">
            {files.map(f => (
              <li key={f.name} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-700">{f.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-xs">{(f.size / 1024).toFixed(1)} KB</span>
                  <button onClick={() => removeFile(f.name)} className="text-slate-400 hover:text-red-500 text-xs">✕</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3 border-t border-surface-border">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="w-full py-2 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {uploading ? '上傳中...' : `上傳 ${files.length} 個檔案`}
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">上傳結果</h2>
          {results.map(({ file, result }) => (
            <div key={file} className={`card p-3 border-l-4 ${result.success ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">{file}</span>
                <span className={`text-xs font-semibold ${result.success ? 'text-green-700' : 'text-red-700'}`}>
                  {result.success ? '✓ 成功' : '✗ 失敗'}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">{result.message || result.error}</p>
              {result.success && (
                <div className="flex gap-3 mt-1 text-xs text-slate-500">
                  {result.date && <span>日期：{result.date}</span>}
                  {result.inserted !== undefined && <span>匯入：{result.inserted} 筆</span>}
                  {result.skipped !== undefined && result.skipped > 0 && <span>略過：{result.skipped} 筆</span>}
                  {result.errors !== undefined && result.errors > 0 && <span className="text-red-600">錯誤：{result.errors} 筆</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
