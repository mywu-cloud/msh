#!/usr/bin/env python3
"""
MSH - 股權分散表大股東籌碼分析系統
TDCC & TWSE 自動化數據爬蟲
每週六 16:00 (Taiwan Time) 由 GitHub Actions 執行

改用 Worker /api/upload-csv 端點上傳 CSV，速度極快 (<1分鐘)
"""

import os
import json
import time
import logging
import zipfile
import io
from datetime import datetime, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup
import pytz

# ─── Logging Setup ────────────────────────────────────────────────────────────
logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────
TW_TZ = pytz.timezone("Asia/Taipei")
TDCC_BASE = "https://www.tdcc.com.tw"
TDCC_QUERY_URL = "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock"
TWSE_API_BASE = "https://openapi.twse.com.tw/v1"
TPEX_API_BASE = "https://www.tpex.org.tw/openapi/v1"

# Worker endpoint for fast D1 upload
WORKER_UPLOAD_URL = "https://msh-api.tw-mywu.workers.dev/api/upload-csv"

# Cloudflare D1 settings (for stock_info only - small dataset)
CF_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
CF_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CF_D1_DB_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID", "")

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# ─── Utility ──────────────────────────────────────────────────────────────────
def tw_now() -> datetime:
        return datetime.now(TW_TZ)

def get_session() -> requests.Session:
        session = requests.Session()
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            "Referer": TDCC_BASE,
        })
        return session

# ─── TDCC Scraper ─────────────────────────────────────────────────────────────
class TDCCScraper:
        """下載 TDCC 集保股權分散表 CSV 原始內容。"""

    def __init__(self):
                self.session = get_session()

    def fetch_available_dates(self) -> list:
                """從 TDCC 查詢頁面取得可用的週報日期清單。"""
                try:
                                resp = self.session.get(TDCC_QUERY_URL, timeout=30)
                                resp.raise_for_status()
                                soup = BeautifulSoup(resp.text, "lxml")
                                select = soup.find("select", {"id": "scaDate"}) or \
                                         soup.find("select", {"name": "scaDate"})
                                if not select:
                                                    log.warning("找不到日期下拉選單")
                                                    return []
                                                options = select.find_all("option")
                                dates = [o.get("value", "").strip() for o in options if o.get("value")]
                                log.info(f"可用日期數量: {len(dates)}, 最新: {dates[0] if dates else 'N/A'}")
                                return dates
except Exception as e:
            log.error(f"fetch_available_dates error: {e}")
                                return []

    def download_csv_raw(self, date_str: str) -> bytes:
                """下載指定日期的股權分散表，回傳原始 CSV bytes。"""
                try:
                                opendata_url = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5"
                                resp = self.session.get(opendata_url, timeout=120, allow_redirects=True)
                                resp.raise_for_status()

                    # If ZIP file, extract CSV bytes
                                if len(resp.content) > 2 and resp.content[:2] == b'PK':
                                                    log.info(f"收到 ZIP 檔，解壓中...")
                                                    return self._extract_zip_csv(resp.content)

                                log.info(f"收到 CSV ({len(resp.content)} bytes)")
                                return resp.content

                except Exception as e:
                                log.error(f"download_csv_raw({date_str}) error: {e}")
                                return b""

            def _extract_zip_csv(self, content: bytes) -> bytes:
                        """解壓 ZIP 並回傳 CSV 內容 bytes。"""
                        try:
                                        with zipfile.ZipFile(io.BytesIO(content)) as z:
                                                            csv_names = [n for n in z.namelist() if n.lower().endswith('.csv')]
                                                            if not csv_names:
                                                                                    log.error("ZIP 內無 CSV 檔案")
                                                                                    return b""
                                                                                with z.open(csv_names[0]) as f:
                                                                                                        data = f.read()
                                                                                                    log.info(f"解壓 CSV: {csv_names[0]}, {len(data)} bytes")
                                                            return data
                        except Exception as e:
                                        log.error(f"_extract_zip_csv error: {e}")
                                        return b""

                # ─── Worker Uploader ──────────────────────────────────────────────────────────
                class WorkerUploader:
                        """透過 Cloudflare Worker /api/upload-csv 端點上傳 CSV。
                            Worker 在 Cloudflare 網路內直接寫入 D1，速度極快。
                                """

    def upload_csv(self, csv_bytes: bytes, date_str: str, filename: str = "data.csv") -> bool:
                """POST CSV 到 Worker 端點，回傳是否成功。"""
                try:
                                # Try different encodings for the CSV
                                csv_text = None
                                for enc in ["utf-8", "big5", "cp950"]:
                                                    try:
                                                                            csv_text = csv_bytes.decode(enc)
                                                                            break
                except Exception:
                                        continue

                    if csv_text is None:
                                        log.error("無法解碼 CSV 內容")
                                        return False

            log.info(f"上傳 CSV 到 Worker: {len(csv_text)} 字元, 日期: {date_str}")

            # Send as multipart form data
            files = {
                                'file': (filename, csv_text.encode('utf-8'), 'text/csv; charset=utf-8')
            }
            data = {'date': date_str}

            resp = requests.post(
                                WORKER_UPLOAD_URL,
                                files=files,
                                data=data,
                                timeout=300,  # 5 min timeout
            )

            if resp.status_code != 200:
                                log.error(f"Worker 回應 HTTP {resp.status_code}: {resp.text[:500]}")
                                return False

            result = resp.json()
            log.info(f"Worker 上傳結果: {result.get('message', result)}")

            if result.get('success'):
                                log.info(f"成功匯入 {result.get('inserted', 0)} 筆，"
                                                                  f"略過 {result.get('skipped', 0)} 筆，"
                                                                  f"失敗 {result.get('errors', 0)} 筆")
                                return True
else:
                log.warning(f"Worker 回報失敗: {result}")
                return result.get('inserted', 0) > 0

except Exception as e:
            log.error(f"upload_csv error: {e}")
            return False

# ─── Cloudflare D1 Writer (for stock_info only) ───────────────────────────────
class CloudflareD1Writer:
        """透過 Cloudflare REST API 寫入 D1 stock_info 表（資料量小，速度可接受）。"""

    BASE = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}"

    def __init__(self):
                self.headers = {
                    "Authorization": f"Bearer {CF_API_TOKEN}",
                    "Content-Type": "application/json",
    }

    def execute_batch(self, statements: list) -> dict:
                url = f"{self.BASE}/batch"
        body = {"statements": statements}
        resp = requests.post(url, headers=self.headers, json=body, timeout=120)
        return resp.json()

    def upsert_stocks(self, stocks: list):
                """批量寫入/更新股票基本資料到 stock_info 表。"""
        if not stocks:
                        return
                    BATCH_SIZE = 100
        total = 0
        for i in range(0, len(stocks), BATCH_SIZE):
                        batch = stocks[i:i + BATCH_SIZE]
                        statements = []
                        for s in batch:
                                            statements.append({
                                                                    "sql": """INSERT INTO stock_info (stock_code, stock_name, market, updated_at)
                                                                    VALUES (?, ?, ?, ?)
                                                                    ON CONFLICT(stock_code) DO UPDATE SET
                                                                    stock_name=CASE WHEN excluded.stock_name!='' THEN excluded.stock_name ELSE stock_name END,
                                                                    market=CASE WHEN excluded.market!='' THEN excluded.market ELSE market END,
                                                                    updated_at=excluded.updated_at""",
                                                                    "params": [
                                                                                                str(s.get("stock_code", "")),
                                                                                                str(s.get("stock_name", "")),
                                                                                                str(s.get("market", "")),
                                                                                                tw_now().strftime("%Y-%m-%d"),
                                                                    ]
                                            })
                                        result = self.execute_batch(statements)
            if result.get("success"):
                                total += len(batch)
                        log.info(f"upsert_stocks: {total} 筆完成")

# ─── TWSE / TPEX Stock List ───────────────────────────────────────────────────
class StockInfoFetcher:
        """從 TWSE / TPEX OpenAPI 取得股票清單。"""

    def __init__(self):
                self.session = get_session()

    def fetch_twse_stocks(self) -> list:
                try:
                                url = f"{TWSE_API_BASE}/exchangeReport/STOCK_DAY_ALL"
                                resp = self.session.get(url, timeout=30)
                                resp.raise_for_status()
                                content = resp.text.strip()
                                if not content or content[0] not in '[{':
                                                    log.warning(f"TWSE API 回傳非 JSON 內容: {content[:100]}")
                                                    return []
                                                data = resp.json()
            log.info(f"TWSE 股票數量: {len(data)}")
            return data if isinstance(data, list) else []
except Exception as e:
            log.error(f"fetch_twse_stocks error: {e}")
            return []

    def fetch_tpex_stocks(self) -> list:
                try:
                                url = f"{TPEX_API_BASE}/exchangeReport/DAILY_CLOSE_QUOTES"
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
            content = resp.text.strip()
            if not content or content[0] not in '[{':
                                log.warning(f"TPEX API 回傳非 JSON 內容: {content[:100]}")
                return []
            data = resp.json()
            log.info(f"TPEX 股票數量: {len(data)}")
            return data if isinstance(data, list) else []
except Exception as e:
            log.error(f"fetch_tpex_stocks error: {e}")
            return []

# ─── JSON Backup Writer ───────────────────────────────────────────────────────
def save_json(data, filename: str):
        path = DATA_DIR / filename
    with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
    log.info(f"JSON 備份: {path}")

# ─── Main Pipeline ────────────────────────────────────────────────────────────
def main():
        log.info("=" * 60)
    log.info("MSH 爬蟲啟動")
    log.info(f"執行時間: {tw_now().strftime('%Y-%m-%d %H:%M:%S %Z')}")
    log.info("=" * 60)

    tdcc = TDCCScraper()
    uploader = WorkerUploader()
    info_fetcher = StockInfoFetcher()

    d1_available = CF_ACCOUNT_ID and CF_API_TOKEN and CF_D1_DB_ID
    d1 = CloudflareD1Writer() if d1_available else None
    if d1:
                log.info("Cloudflare D1 連接成功（用於 stock_info）")
else:
        log.warning("Cloudflare D1 未設定，stock_info 更新跳過")

    # 1. 取得可用日期
    dates = tdcc.fetch_available_dates()
    if not dates:
                today = tw_now().date()
        days_back = (today.weekday() - 5) % 7
        last_sat = today - timedelta(days=days_back)
        dates = [(last_sat - timedelta(weeks=i)).strftime("%Y%m%d") for i in range(4)]
        log.info(f"使用預設日期: {dates}")

    env_dates = os.environ.get("SCRAPE_DATES", "").strip()
    if env_dates:
                target_dates = [d.strip() for d in env_dates.split(",") if d.strip()]
        log.info(f"使用環境變數指定日期: {target_dates}")
else:
        target_dates = dates[:1]
    log.info(f"目標日期: {target_dates}")

    # 2. 下載並上傳各週數據（直接 POST CSV 到 Worker）
    success_dates = []
    for date_str in target_dates:
                log.info(f"\n處理日期: {date_str}")

        csv_bytes = tdcc.download_csv_raw(date_str)
        if not csv_bytes:
                        log.warning(f"日期 {date_str}: 下載失敗，跳過")
            continue

        log.info(f"下載成功: {len(csv_bytes)} bytes，上傳到 Worker...")
        ok = uploader.upload_csv(csv_bytes, date_str, f"TDCC_{date_str}.csv")

        if ok:
                        success_dates.append(date_str)
            log.info(f"日期 {date_str}: Worker 上傳成功！")
            # 備份原始 CSV
            csv_path = DATA_DIR / f"TDCC_{date_str}.csv"
            csv_path.write_bytes(csv_bytes)
            save_json({"date": date_str, "size": len(csv_bytes), "status": "uploaded"}, f"upload_log_{date_str}.json")
else:
            log.error(f"日期 {date_str}: Worker 上傳失敗")

        time.sleep(2)

    log.info(f"\n上傳完成: {len(success_dates)}/{len(target_dates)} 個日期成功")

    # 3. 更新股票清單到 D1 stock_info
    if d1:
                twse_data = info_fetcher.fetch_twse_stocks()
        tpex_data = info_fetcher.fetch_tpex_stocks()

        all_stocks = []
        for row in twse_data:
                        code = str(row.get("Code", row.get("證券代號", ""))).strip()
            name = str(row.get("Name", row.get("證券名稱", ""))).strip()
            if code and len(code) >= 4:
                                all_stocks.append({"stock_code": code, "stock_name": name, "market": "twse"})

        for row in tpex_data:
                        code = str(row.get("SecuritiesCompanyCode", row.get("Code", ""))).strip()
            name = str(row.get("CompanyName", row.get("Name", ""))).strip()
            if code and len(code) >= 4:
                                all_stocks.append({"stock_code": code, "stock_name": name, "market": "tpex"})

        if all_stocks:
                        log.info(f"更新 stock_info: {len(all_stocks)} 筆")
            d1.upsert_stocks(all_stocks)
            save_json(all_stocks[:50], "stocks_sample.json")

    log.info("\n" + "=" * 60)
    log.info("MSH 爬蟲執行完成")
    log.info("=" * 60)

if __name__ == "__main__":
        main()
