#!/usr/bin/env python3
"""
MSH - Worker Upload Scraper
TDCC CSV -> POST to Worker /api/upload-csv (fast D1 write)
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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger(__name__)

TW_TZ = pytz.timezone("Asia/Taipei")
TDCC_BASE = "https://www.tdcc.com.tw"
TDCC_QUERY_URL = "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock"
TWSE_API_BASE = "https://openapi.twse.com.tw/v1"
TPEX_API_BASE = "https://www.tpex.org.tw/openapi/v1"
WORKER_UPLOAD_URL = "https://msh-api.tw-mywu.workers.dev/api/upload-csv"

CF_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
CF_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CF_D1_DB_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID", "")

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)


def tw_now():
    return datetime.now(TW_TZ)


def get_session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        "Referer": TDCC_BASE,
    })
    return s


class TDCCScraper:
    def __init__(self):
        self.session = get_session()

    def fetch_available_dates(self):
        try:
            resp = self.session.get(TDCC_QUERY_URL, timeout=30)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "lxml")
            sel = soup.find("select", {"id": "scaDate"}) or soup.find("select", {"name": "scaDate"})
            if not sel:
                return []
            dates = [o.get("value", "").strip() for o in sel.find_all("option") if o.get("value")]
            log.info(f"可用日期: {len(dates)} 筆, 最新: {dates[0] if dates else 'N/A'}")
            return dates
        except Exception as e:
            log.error(f"fetch_available_dates error: {e}")
            return []

    def download_csv_raw(self, date_str):
        try:
            url = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5"
            resp = self.session.get(url, timeout=120, allow_redirects=True)
            resp.raise_for_status()
            if len(resp.content) > 2 and resp.content[:2] == b'PK':
                log.info("收到 ZIP，解壓中...")
                return self._unzip(resp.content)
            log.info(f"收到 CSV {len(resp.content)} bytes")
            return resp.content
        except Exception as e:
            log.error(f"download_csv_raw error: {e}")
            return b""

    def _unzip(self, data):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                csvs = [n for n in z.namelist() if n.lower().endswith('.csv')]
                if not csvs:
                    return b""
                with z.open(csvs[0]) as f:
                    content = f.read()
                log.info(f"解壓: {csvs[0]}, {len(content)} bytes")
                return content
        except Exception as e:
            log.error(f"_unzip error: {e}")
            return b""


class WorkerUploader:
    def upload_csv(self, csv_bytes, date_str, filename="data.csv"):
        try:
            csv_text = None
            for enc in ["utf-8", "big5", "cp950"]:
                try:
                    csv_text = csv_bytes.decode(enc)
                    break
                except Exception:
                    pass
            if csv_text is None:
                log.error("無法解碼 CSV")
                return False
            log.info(f"上傳 {len(csv_text)} 字元到 Worker, date={date_str}")
            files = {'file': (filename, csv_text.encode('utf-8'), 'text/csv')}
            resp = requests.post(WORKER_UPLOAD_URL, files=files, data={'date': date_str}, timeout=300)
            if resp.status_code != 200:
                log.error(f"Worker HTTP {resp.status_code}: {resp.text[:300]}")
                return False
            result = resp.json()
            log.info(f"Worker 結果: {result.get('message', result)}")
            return result.get('success', False) or result.get('inserted', 0) > 0
        except Exception as e:
            log.error(f"upload_csv error: {e}")
            return False


class CloudflareD1Writer:
    def __init__(self):
        self.base = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}"
        self.headers = {"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"}

    def upsert_stocks(self, stocks):
        if not stocks:
            return
        total = 0
        for i in range(0, len(stocks), 100):
            batch = stocks[i:i+100]
            stmts = [{
                "sql": ("INSERT INTO stock_info (stock_code,stock_name,market,updated_at) VALUES (?,?,?,?) "
                        "ON CONFLICT(stock_code) DO UPDATE SET "
                        "stock_name=CASE WHEN excluded.stock_name!='' THEN excluded.stock_name ELSE stock_name END,"
                        "market=CASE WHEN excluded.market!='' THEN excluded.market ELSE market END,"
                        "updated_at=excluded.updated_at"),
                "params": [str(s.get("stock_code","")), str(s.get("stock_name","")), str(s.get("market","")), tw_now().strftime("%Y-%m-%d")]
            } for s in batch]
            r = requests.post(f"{self.base}/batch", headers=self.headers, json={"statements": stmts}, timeout=120)
            if r.json().get("success"):
                total += len(batch)
        log.info(f"upsert_stocks: {total} 筆")


class StockInfoFetcher:
    def __init__(self):
        self.session = get_session()

    def _fetch_json(self, url):
        try:
            r = self.session.get(url, timeout=30)
            r.raise_for_status()
            txt = r.text.strip()
            if not txt or txt[0] not in '[{':
                log.warning(f"非 JSON: {txt[:80]}")
                return []
            return r.json() if isinstance(r.json(), list) else []
        except Exception as e:
            log.error(f"fetch error {url}: {e}")
            return []

    def fetch_twse_stocks(self):
        data = self._fetch_json(f"{TWSE_API_BASE}/exchangeReport/STOCK_DAY_ALL")
        log.info(f"TWSE: {len(data)} 筆")
        return data

    def fetch_tpex_stocks(self):
        data = self._fetch_json(f"{TPEX_API_BASE}/exchangeReport/DAILY_CLOSE_QUOTES")
        log.info(f"TPEX: {len(data)} 筆")
        return data


def save_json(data, filename):
    p = DATA_DIR / filename
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    log.info(f"JSON: {p}")


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

    # DEBUG: Query D1 schema to find actual table names
    if d1_available:
        try:
            url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}/query"
            headers = {"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"}
            r = requests.post(url, headers=headers, json={"sql": "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"}, timeout=30)
            schema_data = r.json()
            for row in (schema_data.get("result", [{}])[0].get("results", []))[:20]:
                log.info(f"SCHEMA: {row.get('type')} | {row.get('name')} | {str(row.get('sql',''))[:80]}")
        except Exception as e:
            log.error(f"Schema query error: {e}")

    dates = tdcc.fetch_available_dates()
    if not dates:
        today = tw_now().date()
        last_sat = today - timedelta(days=(today.weekday() - 5) % 7)
        dates = [(last_sat - timedelta(weeks=i)).strftime("%Y%m%d") for i in range(4)]

    env_dates = os.environ.get("SCRAPE_DATES", "").strip()
    if env_dates:
        target_dates = [d.strip() for d in env_dates.split(",") if d.strip()]
    else:
        target_dates = dates[:1]
    log.info(f"目標日期: {target_dates}")

    success_dates = []
    for date_str in target_dates:
        log.info(f"\n處理: {date_str}")
        csv_bytes = tdcc.download_csv_raw(date_str)
        if not csv_bytes:
            continue
        ok = uploader.upload_csv(csv_bytes, date_str, f"TDCC_{date_str}.csv")
        if ok:
            success_dates.append(date_str)
            csv_path = DATA_DIR / f"TDCC_{date_str}.csv"
            csv_path.write_bytes(csv_bytes)
            save_json({"date": date_str, "bytes": len(csv_bytes), "ok": True}, f"log_{date_str}.json")
        time.sleep(2)

    log.info(f"\n完成: {len(success_dates)}/{len(target_dates)} 成功")

    if d1:
        twse = info_fetcher.fetch_twse_stocks()
        tpex = info_fetcher.fetch_tpex_stocks()
        stocks = []
        for r in twse:
            c = str(r.get("Code","")).strip()
            n = str(r.get("Name","")).strip()
            if c and len(c) >= 4:
                stocks.append({"stock_code": c, "stock_name": n, "market": "twse"})
        for r in tpex:
            c = str(r.get("SecuritiesCompanyCode", r.get("Code",""))).strip()
            n = str(r.get("CompanyName", r.get("Name",""))).strip()
            if c and len(c) >= 4:
                stocks.append({"stock_code": c, "stock_name": n, "market": "tpex"})
        if stocks:
            d1.upsert_stocks(stocks)

    log.info("\n" + "=" * 60)
    log.info("MSH 爬蟲執行完成")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
