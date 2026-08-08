'use client'

import { useState, useRef } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'
const CHUNK_ROWS = 3000  // 每批上傳筆數，避免 Worker CPU 超時

interface ChunkResult {
  success: boolean
  message: string
  date?: string
  inserted?: number
  skipped?: number
  errors?: number
  error?: string
}

interface FileResult {
  file: string
  success: boolean
  totalInserted: number
  totalErrors: number
  date: string
  chunks: number
  detail: string
}

async function uploadCsvInChunks(file: File): Promise<FileResult> {
  const text = await file.text()
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) {
    return { file: file.name, success: false, totalInserted: 0, totalErrors: 0, date: '', chunks: 0, detail: 'CSV 內容不足' }
  }

  const header = lines[0]
  const dataLines = lines.slice(1)
  const totalChunks = Math.ceil(dataLines.length / CHUNK_ROWS)

  let totalInserted = 0
  let totalErrors = 0
  let date = ''

  for (let i = 0; i < totalChunks; i++) {
    const chunk = dataLines.slice(i * CHUNK_ROWS, (i + 1) * CHUNK_ROWS)
    const chunkCsv = [header, ...chunk].join('\n')
    const form = new FormData()
    form.append('file', new Blob([chunkCsv], { type: 'text/csv' }), file.name)
    form.append('source', 'tdcc')
    form.append('chunk_index', String(i))

    const res = await fetch(`${API_BASE}/api/upload-csv`, { method: 'POST', body: form })
    if (!res.ok) {
      totalErrors += chunk.length
      continue
    }
    const json: ChunkResult = await res.json()
    if (json.success) {
      totalInserted += json.inserted || 0
      totalErrors += json.errors || 0
      if (json.date && !date) date = json.date
    } else {
      totalErrors += chunk.length
    }
  }

  return {
    file: file.name,
    success: totalErrors === 0 || totalInserted > 0,
    totalInserted,
    totalErrors,
    date,
    chunks: totalChunks,
    detail: `共 ${dataLines.length} 行，分 ${totalChunks} 批上傳，匯入 ${totalInserted} 筆${totalErrors > 0 ? `，失敗 ${totalErrors} 筆` : ''}`,
  }
}

export default function UploadPage() {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number; file: string } | null>(null)
  const [results, setResults] = useState<FileResult[]>([])
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
    const newResults: FileResult[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setProgress({ current: i + 1, total: files.length, file: file.name })
      const result = await uploadCsvInChunks(file)
      newResults.push(result)
      setResults([...newResults])
    }

    setProgress(null)
    setUploading(false)
    setFiles(prev => prev.filter(f => newResults.find(r => r.file === f.name && !r.success)))
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
        <p className="text-xs text-slate-400 mt-1">支援多檔案同時上傳（.csv），大檔案自動分批處理</p>
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
                  {!uploading && (
                    <button onClick={() => removeFile(f.name)} className="text-slate-400 hover:text-red-500 text-xs">✕</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3 border-t border-surface-border">
            {progress ? (
              <div className="text-center text-sm text-slate-600">
                <div className="mb-1">正在上傳 {progress.file}（{progress.current}/{progress.total}）...</div>
                <div className="w-full bg-slate-200 rounded-full h-1.5">
                  <div
                    className="bg-primary-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : (
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="w-full py-2 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors"
              >
                上傳 {files.length} 個檔案
              </button>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">上傳結果</h2>
          {results.map(r => (
            <div key={r.file} className={`card p-3 border-l-4 ${r.success ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">{r.file}</span>
                <span className={`text-xs font-semibold ${r.success ? 'text-green-700' : 'text-red-700'}`}>
                  {r.success ? '✓ 成功' : '✗ 失敗'}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">{r.detail}</p>
              {r.date && <p className="text-xs text-slate-400 mt-0.5">日期：{r.date}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
