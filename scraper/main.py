#!/usr/bin/env python3
"""
MSH – 股權分散表大股東籌碼分析系統
TDCC & TWSE 自動化數據爬蟲
每週六 16:00 (Taiwan Time) 由 GitHub Actions 執行
"""

import os
import re
import json
import time
import logging
import zipfile
import io
from datetime import datetime, timedelta
from pathlib import Path

import requests
import pandas as pd
import numpy as np
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

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# Cloudflare D1 settings (from env vars)
CF_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
CF_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CF_D1_DB_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID", "")

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
    """下載 TDCC 集保股權分散表 CSV，解析為 DataFrame。"""

    def __init__(self):
        self.session = get_session()

    def fetch_available_dates(self) -> list[str]:
        """從 TDCC 查詢頁面取得可用的週報日期清單。"""
        try:
            resp = self.session.get(TDCC_QUERY_URL, timeout=30)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "lxml")
            select = soup.find("select", {"id": "scaDate"}) or \
                     soup.find("select", {"name": "scaDate"})
            if not select:
                log.warning("找不到日期下拉選單，嘗試抓取最新日期")
                return []
            options = select.find_all("option")
            dates = [o.get("value", "").strip() for o in options if o.get("value")]
            log.info(f"可用日期數量: {len(dates)}, 最新: {dates[0] if dates else 'N/A'}")
            return dates
        except Exception as e:
            log.error(f"fetch_available_dates error: {e}")
            return []

    def download_csv_zip(self, date_str: str) -> pd.DataFrame | None:
        """下載指定日期的股權分散表 CSV，解析為 DataFrame。"""
        try:
            opendata_url = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5"
            resp = self.session.get(opendata_url, timeout=120, allow_redirects=True)
            resp.raise_for_status()

            if len(resp.content) > 2 and resp.content[:2] == b'PK':
                return self._parse_zip(resp.content)

            for enc in ["utf-8", "big5"]:
                try:
                    df = pd.read_csv(io.BytesIO(resp.content), encoding=enc, header=None)
                    if len(df) < 100:
                        continue
                    if df.shape[1] >= 6:
                        df.columns = ['date', 'stock_code', 'bracket', 'holders', 'shares', 'ratio'] + \
                                     [f'extra_{i}' for i in range(df.shape[1] - 6)]
                        log.info(f"成功解析 CSV ({enc}): {len(df)} 行")
                        return df
                except Exception:
                    continue

            log.warning(f"日期 {date_str}: 無法解析回應內容")
            return None

        except Exception as e:
            log.error(f"download_csv_zip({date_str}) error: {e}")
            return None

    def _parse_zip(self, content: bytes) -> pd.DataFrame | None:
        """解壓 ZIP 並解析內含的 CSV。"""
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as z:
                csv_names = [n for n in z.namelist() if n.lower().endswith('.csv')]
                if not csv_names:
                    return None
                with z.open(csv_names[0]) as f:
                    df = pd.read_csv(f, encoding="big5", header=1)
                log.info(f"成功解析 ZIP CSV: {len(df)} 行")
                return df
        except Exception as e:
            log.error(f"_parse_zip error: {e}")
            return None

    def parse_distribution(self, df: pd.DataFrame, date_str: str) -> list[dict]:
        """將原始 DataFrame 轉換為標準化的持股分布紀錄列表。"""
        records = []
        if df is None or df.empty:
            return records

        df.columns = [str(c).strip() for c in df.columns]
        col_map = {
            "證券代號": "stock_code", "股票代號": "stock_code",
            "證券名稱": "stock_name", "股票名稱": "stock_name",
            "持股分級": "bracket", "人數": "holders",
            "股數": "shares", "佔集保庫存數比例": "ratio", "比例": "ratio",
        }
        for old, new in col_map.items():
            if old in df.columns:
                df = df.rename(columns={old: new})

        required = ["stock_code", "holders", "shares"]
        if not all(c in df.columns for c in required):
            log.warning(f"欄位不足: {df.columns.tolist()}")
            return records
        # 保持 YYYYMMDD 格式（與 D1 現有資料一致）
        iso_date = date_str

        for _, row in df.iterrows():
            try:
                code = str(row.get("stock_code", "")).strip().zfill(4)
                name = str(row.get("stock_name", "")).strip()
                bracket = str(row.get("bracket", "")).strip()
                holders = int(str(row.get("holders", 0)).replace(",", "").replace(" ", "") or 0)
                shares = int(str(row.get("shares", 0)).replace(",", "").replace(" ", "") or 0)
                ratio = float(str(row.get("ratio", 0.0)).replace(",", "").replace("%", "") or 0.0)

                records.append({
                    "stock_code": code,
                    "stock_name": name,
                    "date": iso_date,
                    "bracket": bracket,
                    "holders": holders,
                    "shares": shares,
                    "ratio": ratio,
                })
            except Exception:
                continue

        log.info(f"解析完成: {date_str} → {len(records)} 筆持股分布紀錄")
        return records

# ─── TWSE / TPEX Stock List ───────────────────────────────────────────────────
class StockInfoFetcher:
    """從 TWSE / TPEX OpenAPI 取得股票清單。"""

    def __init__(self):
        self.session = get_session()

    def fetch_twse_stocks(self) -> pd.DataFrame:
        try:
            url = f"{TWSE_API_BASE}/exchangeReport/STOCK_DAY_ALL"
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
            df = pd.DataFrame(resp.json())
            log.info(f"TWSE 股票數量: {len(df)}")
            return df
        except Exception as e:
            log.error(f"fetch_twse_stocks error: {e}")
            return pd.DataFrame()

    def fetch_tpex_stocks(self) -> pd.DataFrame:
        try:
            url = f"{TPEX_API_BASE}/exchangeReport/DAILY_CLOSE_QUOTES"
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
            df = pd.DataFrame(resp.json())
            log.info(f"TPEX 股票數量: {len(df)}")
            return df
        except Exception as e:
            log.error(f"fetch_tpex_stocks error: {e}")
            return pd.DataFrame()

# ─── Cloudflare D1 Writer ─────────────────────────────────────────────────────
class CloudflareD1Writer:
    """透過 Cloudflare REST API 寫入 D1 資料庫。
    
    寫入 holder_distribution 表（與 backend API 一致）。
    D1 每次查詢最多 100 個參數，採用逐筆 INSERT 批次提交。
    """

    BASE = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}"

    def __init__(self):
        self.headers = {
            "Authorization": f"Bearer {CF_API_TOKEN}",
            "Content-Type": "application/json",
        }

    def execute_sql(self, sql: str, params: list | None = None) -> dict:
        url = f"{self.BASE}/query"
        body = {"sql": sql, "params": params or []}
        resp = requests.post(url, headers=self.headers, json=body, timeout=60)
        return resp.json()

    def execute_batch(self, statements: list[dict]) -> dict:
        """批次執行多條 SQL (D1 batch API)"""
        url = f"{self.BASE}/batch"
        body = {"database_id": CF_D1_DB_ID, "statements": statements}
        resp = requests.post(url, headers=self.headers, json=body, timeout=120)
        return resp.json()

    def upsert_distributions(self, records: list[dict]):
        """
        批量寫入持股分布數據到 holder_distribution 表。
        使用 D1 batch API，每次最多 10 筆以避免 too-many-variables 錯誤。
        """
        if not records:
            return

        # 使用 D1 batch API，每批最多 100 筆（每個 INSERT 獨立 statement，無 too-many-variables 問題）
        BATCH_SIZE = 100
        total_inserted = 0
        total_failed = 0

        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i:i + BATCH_SIZE]
            statements = []
            for r in batch:
                statements.append({
                    "sql": """INSERT INTO holder_distribution (stock_code, date, bracket, holders, shares, ratio)
                              VALUES (?, ?, ?, ?, ?, ?)
                              ON CONFLICT(stock_code, date, bracket) DO UPDATE SET
                              holders=excluded.holders, shares=excluded.shares, ratio=excluded.ratio""",
                    "params": [
                        str(r["stock_code"]),
                        str(r["date"]),
                        str(r["bracket"]),
                        int(r.get("holders", 0) or 0),
                        int(r.get("shares", 0) or 0),
                        float(r.get("ratio", 0.0) or 0.0),
                    ]
                })
            
            result = self.execute_batch(statements)
            if result.get("success"):
                total_inserted += len(batch)
            else:
                # Fall back to individual inserts
                for r in batch:
                    r2 = self.execute_sql(
                        """INSERT INTO holder_distribution (stock_code, date, bracket, holders, shares, ratio)
                           VALUES (?, ?, ?, ?, ?, ?)
                           ON CONFLICT(stock_code, date, bracket) DO UPDATE SET
                           holders=excluded.holders, shares=excluded.shares, ratio=excluded.ratio""",
                        [str(r["stock_code"]), str(r["date"]), str(r["bracket"]),
                         int(r.get("holders", 0) or 0), int(r.get("shares", 0) or 0),
                         float(r.get("ratio", 0.0) or 0.0)]
                    )
                    if r2.get("success"):
                        total_inserted += 1
                    else:
                        total_failed += 1

            # Progress log every 5000 records
            if (i + BATCH_SIZE) % 5000 < BATCH_SIZE:
                log.info(f"進度: {i + BATCH_SIZE}/{len(records)} 筆")

        log.info(f"upsert_distributions 完成: 成功 {total_inserted}, 失敗 {total_failed}")

    def upsert_stocks(self, stocks: list[dict]):
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

# ─── JSON Backup Writer ───────────────────────────────────────────────────────
def save_json(data: dict | list, filename: str):
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
    info_fetcher = StockInfoFetcher()

    # 連接 D1
    d1_available = CF_ACCOUNT_ID and CF_API_TOKEN and CF_D1_DB_ID
    d1 = CloudflareD1Writer() if d1_available else None
    if d1:
        log.info("Cloudflare D1 連接成功")
    else:
        log.warning("Cloudflare D1 未設定，僅備份 JSON")

    # 1. 取得可用日期
    dates = tdcc.fetch_available_dates()
    if not dates:
        today = tw_now().date()
        days_back = (today.weekday() - 5) % 7
        last_sat = today - timedelta(days=days_back)
        dates = [(last_sat - timedelta(weeks=i)).strftime("%Y%m%d") for i in range(4)]
        log.info(f"使用預設日期: {dates}")

    # 支援環境變數指定特定日期
    env_dates = os.environ.get("SCRAPE_DATES", "").strip()
    if env_dates:
        target_dates = [d.strip() for d in env_dates.split(",") if d.strip()]
        log.info(f"使用環境變數指定日期: {target_dates}")
    else:
        target_dates = dates[:1]
        log.info(f"目標日期: {target_dates}")

    # 2. 下載並解析各週數據
    all_records = []
    for date_str in target_dates:
        log.info(f"\n處理日期: {date_str}")

        df = tdcc.download_csv_zip(date_str)
        if df is None:
            log.warning(f"日期 {date_str}: 下載失敗，跳過")
            continue

        records = tdcc.parse_distribution(df, date_str)
        if not records:
            log.warning(f"日期 {date_str}: 解析結果為空，跳過")
            continue

        all_records.extend(records)

        if d1 and records:
            log.info(f"寫入 D1 holder_distribution: {len(records)} 筆...")
            d1.upsert_distributions(records)

        save_json(records[:1000], f"distribution_{date_str}.json")
        time.sleep(1)

    log.info(f"\n總計解析: {len(all_records)} 筆持股分布紀錄")

    # 3. 儲存股票清單到 D1
    twse_stocks = info_fetcher.fetch_twse_stocks()
    tpex_stocks = info_fetcher.fetch_tpex_stocks()

    if not twse_stocks.empty:
        save_json(twse_stocks.head(100).to_dict(orient="records"), "twse_stocks.json")
    if not tpex_stocks.empty:
        save_json(tpex_stocks.head(100).to_dict(orient="records"), "tpex_stocks.json")

    if d1:
        all_stocks = []
        if not twse_stocks.empty:
            for _, row in twse_stocks.iterrows():
                code = str(row.get("Code", row.get("股票代號", ""))).strip()
                name = str(row.get("Name", row.get("股票名稱", ""))).strip()
                if code:
                    all_stocks.append({"stock_code": code, "stock_name": name, "market": "twse"})
        if not tpex_stocks.empty:
            for _, row in tpex_stocks.iterrows():
                code = str(row.get("Code", row.get("股票代號", ""))).strip()
                name = str(row.get("Name", row.get("股票名稱", ""))).strip()
                if code:
                    all_stocks.append({"stock_code": code, "stock_name": name, "market": "tpex"})
        if all_stocks:
            d1.upsert_stocks(all_stocks)
            log.info(f"已寫入 {len(all_stocks)} 筆股票基本資料")

    log.info("\n" + "=" * 60)
    log.info("MSH 爬蟲執行完成")
    log.info("=" * 60)

if __name__ == "__main__":
    main()
