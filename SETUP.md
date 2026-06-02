# MSH 部署指南

## 系統架構

```
GitHub Repo (msh)
├── .github/workflows/main.yml  → 每週六 16:00 自動爬取 TDCC
├── scraper/                    → Python 爬蟲 + Skill 分析
├── backend/                    → Cloudflare Workers API
└── frontend/                   → Next.js → Cloudflare Pages
```

---

## 第一步：Cloudflare D1 資料庫設定

```bash
cd backend

# 安裝 Wrangler
npm install

# 登入 Cloudflare
npx wrangler login

# 建立 D1 資料庫
npx wrangler d1 create msh-stock-db
# 複製輸出的 database_id，填入 wrangler.toml

# 初始化 Schema
npx wrangler d1 execute msh-stock-db --file=schema.sql
```

## 第二步：KV Namespace 設定

```bash
# 建立 KV Namespace (用於 API 快取)
npx wrangler kv namespace create CACHE
# 複製輸出的 id，填入 wrangler.toml
```

## 第三步：部署 Cloudflare Workers API

```bash
# 更新 wrangler.toml 中的 database_id 與 kv namespace id
# 然後部署
npx wrangler deploy

# API 會部署到類似 https://msh-api.YOUR_SUBDOMAIN.workers.dev
```

## 第四步：設定 GitHub Actions Secrets

在 GitHub Repo > Settings > Secrets and Variables > Actions，新增以下 secrets：

| Secret 名稱 | 說明 |
|------------|------|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard > 右側 Account ID |
| `CLOUDFLARE_API_TOKEN` | 建立 API Token，權限：D1:Edit |
| `CLOUDFLARE_D1_DATABASE_ID` | D1 資料庫 ID |

## 第五步：部署前端至 Cloudflare Pages

### 方法 A：Cloudflare Pages 自動部署（推薦）

1. Cloudflare Dashboard > Pages > Create a project
2. Connect to Git > 選擇此 Repo
3. 設定：
   - Framework preset: **Next.js (Static HTML Export)**
      - Build command: `cd frontend && npm install && npm run build`
         - Build output directory: `frontend/out`
         4. 環境變數：
            - `NEXT_PUBLIC_API_URL` = `https://msh-api.YOUR_SUBDOMAIN.workers.dev`

            ### 方法 B：手動部署

            ```bash
            cd frontend
            npm install
            NEXT_PUBLIC_API_URL=https://msh-api.YOUR_SUBDOMAIN.workers.dev npm run build
            npx wrangler pages deploy out --project-name=msh-frontend
            ```

            ## 第六步：手動觸發第一次數據爬取

            GitHub Actions > Workflows > TDCC Stock Data Weekly Scraper > Run workflow

            ---

            ## 開發環境

            ```bash
            # 前端開發
            cd frontend
            npm install
            npm run dev
            # → http://localhost:3000

            # 後端 API 本地測試
            cd backend
            npm install
            npm run dev
            # → http://localhost:8787
            ```

            ---

            ## 排程說明

            - GitHub Actions cron: `0 8 * * 6` = UTC 08:00 週六 = **台灣時間 16:00 週六**
            - TDCC 通常在每週五傍晚更新，週六下午執行確保數據已更新
            - 可在 GitHub Actions 手動觸發補跑

            ---

            ## 資料流

            ```
            TDCC 網站 (週五更新)
                ↓ 週六 16:00 GitHub Actions
                scraper/main.py
                    ↓
                    Cloudflare D1 (資料庫)
                        ↓
                        Cloudflare Workers API (/api/skill-analysis)
                            ↓
                            Next.js Frontend (Cloudflare Pages)
                                ↓
                                使用者瀏覽器
                                ```

                                ---

                                ## API 端點

                                | 端點 | 說明 |
                                |------|------|
                                | `GET /api/skill-analysis?market=twse&limit=20` | 起漲潛力標的 |
                                | `GET /api/distribution/2303` | 個股持股分布 |
                                | `GET /api/top-changes?type=increase` | 本週籌碼異動 |
                                | `GET /api/search?q=聯電` | 搜尋股票 |
                                | `GET /api/stats` | 系統統計 |
