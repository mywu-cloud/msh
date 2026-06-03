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
TDCC_DOWNLOAD_URL = "https://www.tdcc.com.tw/smWeb/QryStockAjax.do"
TWSE_API_BASE = "https://openapi.twse.com.tw/v1"
TPEX_API_BASE = "https://www.tpex.org.tw/openapi/v1"

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# Cloudflare D1 settings (from env vars)
CF_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
CF_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CF_D1_DB_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID", "")

# ─── Bracket definitions (持股級距) ──────────────────────────────────────────
BRACKETS = [
    {"id": "1",  "label": "1-999",          "min": 1,      "max": 999},
    {"id": "2",  "label": "1,000-5,000",    "min": 1000,   "max": 5000},
    {"id": "3",  "label": "5,001-10,000",   "min": 5001,   "max": 10000},
    {"id": "4",  "label": "10,001-15,000",  "min": 10001,  "max": 15000},
    {"id": "5",  "label": "15,001-20,000",  "min": 15001,  "max": 20000},
    {"id": "6",  "label": "20,001-30,000",  "min": 20001,  "max": 30000},
    {"id": "7",  "label": "30,001-40,000",  "min": 30001,  "max": 40000},
    {"id": "8",  "label": "40,001-50,000",  "min": 40001,  "max": 50000},
    {"id": "9",  "label": "50,001-100,000", "min": 50001,  "max": 100000},
    {"id": "10", "label": "100,001-200,000","min": 100001, "max": 200000},
    {"id": "11", "label": "200,001-400,000","min": 200001, "max": 400000},
    {"id": "12", "label": "400,001以上",    "min": 400001, "max": 9999999},
    {"id": "13", "label": "合計",           "min": 0,      "max": 9999999},
]


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
            # 找 scaDate 下拉選單
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
        """
        下載指定日期的股權分散表 ZIP，解壓後解析 CSV。
        date_str 格式: YYYYMMDD (民國年) 或 YYYY-MM-DD
        """
        try:
            payload = {
                "actionType": "ajax",
                "method": "qryByDate",
                "scaDate": date_str,
                "StockNo": "",
                "StockName": "",
            }
            resp = self.session.post(TDCC_DOWNLOAD_URL, data=payload, timeout=60)
            resp.raise_for_status()

            # 嘗試解析 JSON 回應中的下載連結
            try:
                data = resp.json()
                download_url = data.get("url") or data.get("downloadUrl")
                if download_url:
                    zip_resp = self.session.get(
                        TDCC_BASE + download_url if not download_url.startswith("http") else download_url,
                        timeout=120
                    )
                    return self._parse_zip(zip_resp.content)
            except Exception:
                pass

            # 直接嘗試解析為 ZIP
            if resp.content[:2] == b'PK':
                return self._parse_zip(resp.content)

            log.warning(f"日期 {date_str}: 回應非 ZIP 格式")
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
                    log.warning("ZIP 內無 CSV 檔案")
                    return None
                with z.open(csv_names[0]) as f:
                    df = pd.read_csv(f, encoding="big5", header=1)
                log.info(f"成功解析 CSV: {len(df)} 行")
                return df
        except Exception as e:
            log.error(f"_parse_zip error: {e}")
            return None

    def parse_distribution(self, df: pd.DataFrame, date_str: str) -> list[dict]:
        """
        將原始 DataFrame 轉換為標準化的持股分布紀錄列表。
        回傳: [{stock_code, stock_name, date, bracket_id, holders, shares, ratio}, ...]
        """
        records = []
        if df is None or df.empty:
            return records

        # 標準化欄位名稱 (TDCC 欄位名稱可能因版本不同)
        df.columns = [str(c).strip() for c in df.columns]
        col_map = {
            "證券代號": "stock_code",
            "股票代號": "stock_code",
            "證券名稱": "stock_name",
            "股票名稱": "stock_name",
            "持股分級": "bracket",
            "人數": "holders",
            "股數": "shares",
            "佔集保庫存數比例": "ratio",
            "比例": "ratio",
        }

        for old, new in col_map.items():
            if old in df.columns:
                df = df.rename(columns={old: new})

        required = ["stock_code", "holders", "shares"]
        if not all(c in df.columns for c in required):
            log.warning(f"欄位不足: {df.columns.tolist()}")
            return records

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
                    "date": date_str,
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
    """從 TWSE / TPEX OpenAPI 取得股票清單與股價。"""

    def __init__(self):
        self.session = get_session()

    def fetch_twse_stocks(self) -> pd.DataFrame:
        """取得上市股票清單。"""
        try:
            url = f"{TWSE_API_BASE}/exchangeReport/STOCK_DAY_ALL"
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            df = pd.DataFrame(data)
            log.info(f"TWSE 股票數量: {len(df)}")
            return df
        except Exception as e:
            log.error(f"fetch_twse_stocks error: {e}")
            return pd.DataFrame()

    def fetch_tpex_stocks(self) -> pd.DataFrame:
        """取得上櫃股票清單。"""
        try:
            url = f"{TPEX_API_BASE}/exchangeReport/DAILY_CLOSE_QUOTES"
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            df = pd.DataFrame(data)
            log.info(f"TPEX 股票數量: {len(df)}")
            return df
        except Exception as e:
            log.error(f"fetch_tpex_stocks error: {e}")
            return pd.DataFrame()

    def fetch_stock_prices(self, market: str = "twse") -> pd.DataFrame:
        """取得股價資料 (最近收盤價)。"""
        try:
            if market == "twse":
                url = f"{TWSE_API_BASE}/exchangeReport/STOCK_DAY_ALL"
            else:
                url = f"{TPEX_API_BASE}/exchangeReport/DAILY_CLOSE_QUOTES"
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
            df = pd.DataFrame(resp.json())
            return df
        except Exception as e:
            log.error(f"fetch_stock_prices({market}) error: {e}")
            return pd.DataFrame()


# ─── Skill Analysis Engine ────────────────────────────────────────────────────
class SkillAnalyzer:
    """
    大股東籌碼 Skill 分析引擎
    篩選「起漲潛力」標的
    """

    def __init__(self, history: list[dict]):
        """
        history: 多週持股分布紀錄
        """
        self.df = pd.DataFrame(history) if history else pd.DataFrame()

    def compute_concentration_score(self) -> pd.DataFrame:
        """
        計算各股票的籌碼集中度分數 (0-100)

        評分邏輯:
        1. 400張以上大股東持股佔比連續增加 (權重 35%)
        2. 1000張以上超大股東持股佔比連續增加 (權重 25%)
        3. 散戶 (<1張) 持股佔比縮減 (權重 20%)
        4. 股東人數下降 (籌碼集中) (權重 20%)
        """
        if self.df.empty:
            return pd.DataFrame()

        results = []
        stocks = self.df["stock_code"].unique()

        for code in stocks:
            stock_df = self.df[self.df["stock_code"] == code].copy()
            if len(stock_df) < 2:
                continue

            name = stock_df["stock_name"].iloc[-1] if "stock_name" in stock_df.columns else code

            # 依日期排序
            dates = sorted(stock_df["date"].unique())
            weeks = min(len(dates), 5)  # 最近5週

            score = 0.0
            details = {}

            # 1. 大股東 (400張以上) 持股比例趨勢
            big_holder_ratios = []
            for d in dates[-weeks:]:
                week_df = stock_df[stock_df["date"] == d]
                # bracket >= 9 (50,001張以上) 或 bracket label 含 "400"
                big = week_df[week_df["bracket"].astype(str).str.contains(
                    r"(400,001|200,001|100,001|50,001)", regex=True
                )]
                big_ratio = big["ratio"].sum()
                big_holder_ratios.append(big_ratio)

            if len(big_holder_ratios) >= 2:
                trend_score = sum(
                    1 for i in range(1, len(big_holder_ratios))
                    if big_holder_ratios[i] > big_holder_ratios[i-1]
                )
                score += (trend_score / (len(big_holder_ratios) - 1)) * 35
                details["big_holder_trend"] = trend_score
                details["big_holder_ratio_latest"] = big_holder_ratios[-1]

            # 2. 散戶持股比例趨勢 (下降為正向)
            retail_ratios = []
            for d in dates[-weeks:]:
                week_df = stock_df[stock_df["date"] == d]
                retail = week_df[week_df["bracket"].astype(str).str.contains(
                    r"1-999", regex=True
                )]
                retail_ratio = retail["ratio"].sum()
                retail_ratios.append(retail_ratio)

            if len(retail_ratios) >= 2:
                retail_decline = sum(
                    1 for i in range(1, len(retail_ratios))
                    if retail_ratios[i] < retail_ratios[i-1]
                )
                if retail_decline > 0:
                    score += (retail_decline / (len(retail_ratios) - 1)) * 20
                details["retail_trend"] = retail_decline
                details["retail_ratio_latest"] = retail_ratios[-1]

            # 3. 總股東人數變化 (下降為正向)
            total_holders = []
            for d in dates[-weeks:]:
                week_df = stock_df[stock_df["date"] == d]
                total_row = week_df[week_df["bracket"].astype(str).str.contains("合計")]
                if not total_row.empty:
                    total_holders.append(int(total_row["holders"].iloc[0]))

            if len(total_holders) >= 2:
                holder_decline = sum(
                    1 for i in range(1, len(total_holders))
                    if total_holders[i] < total_holders[i-1]
                )
                if holder_decline > 0:
                    score += (holder_decline / (len(total_holders) - 1)) * 20
                details["holder_change"] = total_holders[-1] - total_holders[0] if total_holders else 0

            # 4. 本週籌碼異動警示 (大幅增加)
            alert = False
            if len(big_holder_ratios) >= 2:
                latest_change = big_holder_ratios[-1] - big_holder_ratios[-2]
                if latest_change > 2.0:  # 大股東比例單週增加超過 2%
                    score += 25
                    alert = True
                details["latest_week_change"] = round(latest_change, 2)
                details["alert"] = alert

            results.append({
                "stock_code": code,
                "stock_name": name,
                "skill_score": round(score, 1),
                "big_holder_ratio_latest": details.get("big_holder_ratio_latest", 0),
                "big_holder_trend": details.get("big_holder_trend", 0),
                "retail_trend": details.get("retail_trend", 0),
                "holder_change": details.get("holder_change", 0),
                "latest_week_change": details.get("latest_week_change", 0),
                "alert": alert,
                "weeks_analyzed": weeks,
            })

        result_df = pd.DataFrame(results)
        if not result_df.empty:
            result_df = result_df.sort_values("skill_score", ascending=False)
        return result_df

    def get_top_candidates(self, top_n: int = 20, market: str = "all") -> list[dict]:
        """取得起漲潛力前 N 檔標的。"""
        scored = self.compute_concentration_score()
        if scored.empty:
            return []

        if market == "twse":
            scored = scored[scored["stock_code"].str.len() == 4]
        elif market == "tpex":
            scored = scored[scored["stock_code"].str.len() != 4]

        top = scored.head(top_n)
        return top.to_dict(orient="records")


# ─── Cloudflare D1 Writer ─────────────────────────────────────────────────────
class CloudflareD1Writer:
    """透過 Cloudflare REST API 寫入 D1 資料庫。"""

    BASE = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}"

    def __init__(self):
        self.headers = {
            "Authorization": f"Bearer {CF_API_TOKEN}",
            "Content-Type": "application/json",
        }

    def execute_sql(self, sql: str, params: list | None = None) -> dict:
        url = f"{self.BASE}/query"
        body = {"sql": sql, "params": params or []}
        resp = requests.post(url, headers=self.headers, json=body, timeout=30)
        return resp.json()

    def init_schema(self):
        """建立資料表（若不存在）。"""
        sqls = [
            """
            CREATE TABLE IF NOT EXISTS stocks (
                stock_code TEXT PRIMARY KEY,
                stock_name TEXT,
                market TEXT,
                industry TEXT,
                updated_at TEXT
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS distributions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stock_code TEXT,
                date TEXT,
                bracket TEXT,
                holders INTEGER,
                shares INTEGER,
                ratio REAL,
                UNIQUE(stock_code, date, bracket)
            );
            """,
            """
            CREATE TABLE IF NOT EXISTS skill_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stock_code TEXT,
                analysis_date TEXT,
                skill_score REAL,
                big_holder_ratio REAL,
                big_holder_trend INTEGER,
                retail_trend INTEGER,
                holder_change INTEGER,
                latest_week_change REAL,
                alert INTEGER,
                UNIQUE(stock_code, analysis_date)
            );
            """,
        ]
        for sql in sqls:
            result = self.execute_sql(sql)
            if not result.get("success"):
                log.warning(f"init_schema SQL failed: {result}")

    def upsert_distributions(self, records: list[dict]):
        """批量寫入持股分布數據。"""
        sql = """
            INSERT INTO distributions (stock_code, date, bracket, holders, shares, ratio)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(stock_code, date, bracket) DO UPDATE SET
                holders=excluded.holders, shares=excluded.shares, ratio=excluded.ratio
        """
        for r in records:
            params = [
                r["stock_code"],
                r["date"],
                r["bracket"],
                r["holders"],
                r["shares"],
                r["ratio"],
            ]
            result = self.execute_sql(sql, params)
            if not result.get("success"):
                log.info(f"upsert_distributions: {len(records)} 筆完成")

    def upsert_skill_analysis(self, analysis_date: str, candidates: list[dict]):
        """寫入 Skill 分析結果。"""
        sql = """
            INSERT INTO skill_analysis
                (stock_code, analysis_date, skill_score, big_holder_ratio,
                 big_holder_trend, retail_trend, holder_change,
                 latest_week_change, alert)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(stock_code, analysis_date) DO UPDATE SET
                skill_score=excluded.skill_score,
                big_holder_ratio=excluded.big_holder_ratio,
                alert=excluded.alert
        """
        for r in candidates:
            params = [
                r["stock_code"],
                analysis_date,
                r.get("skill_score", 0),
                r.get("big_holder_ratio_latest", 0),
                r.get("big_holder_trend", 0),
                r.get("retail_trend", 0),
                r.get("holder_change", 0),
                r.get("latest_week_change", 0),
                1 if r.get("alert") else 0,
            ]
            self.execute_sql(sql, params)
        log.info(f"upsert_skill_analysis: {len(candidates)} 筆完成")


# ─── JSON Backup Writer ───────────────────────────────────────────────────────
def save_json(data: dict | list, filename: str):
    """將數據儲存為 JSON 備份檔案。"""
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

    # 初始化
    tdcc = TDCCScraper()
    info_fetcher = StockInfoFetcher()

    # 連接 D1
    d1_available = CF_ACCOUNT_ID and CF_API_TOKEN and CF_D1_DB_ID
    d1 = CloudflareD1Writer() if d1_available else None
    if d1:
        log.info("Cloudflare D1 連接成功，初始化 Schema...")
        d1.init_schema()
    else:
        log.warning("Cloudflare D1 未設定，僅備份 JSON")

    # 1. 取得可用日期
    dates = tdcc.fetch_available_dates()
    if not dates:
        # 若無法取得日期清單，嘗試最近幾個週六
        today = tw_now().date()
        days_back = (today.weekday() - 5) % 7  # 上個週六
        last_friday = today - timedelta(days=days_back)
        dates = [(last_friday - timedelta(weeks=i)).strftime("%Y%m%d") for i in range(4)]
        log.info(f"使用預設日期: {dates}")

    target_dates = dates[:4]  # 最近4週
    log.info(f"目標日期: {target_dates}")

    # 2. 下載並解析各週數據
    all_records = []
    for date_str in target_dates:
        log.info(f"\n處理日期: {date_str}")
        log.info("-" * 40)

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
            log.info(f"寫入 D1: {len(records)} 筆...")
            d1.upsert_distributions(records)

        # 備份 JSON
        save_json(records, f"distribution_{date_str}.json")
        time.sleep(2)  # 避免過於頻繁請求

    log.info(f"\n總計解析: {len(all_records)} 筆持股分布紀錄")

    # 3. Skill 分析
    if all_records:
        log.info("\n執行 Skill 分析...")
        analyzer = SkillAnalyzer(all_records)

        twse_top = analyzer.get_top_candidates(top_n=20, market="twse")
        tpex_top = analyzer.get_top_candidates(top_n=20, market="tpex")

        analysis_date = tw_now().strftime("%Y-%m-%d")

        log.info(f"\n【上市起漲潛力 TOP {len(twse_top)}】")
        for i, s in enumerate(twse_top[:5], 1):
            log.info(f"  {i}. {s['stock_code']} {s['stock_name']} | "
                     f"Score: {s['skill_score']} | "
                     f"{'暴增' if s.get('alert') else ''}")

        log.info(f"\n【上櫃起漲潛力 TOP {len(tpex_top)}】")
        for i, s in enumerate(tpex_top[:5], 1):
            log.info(f"  {i}. {s['stock_code']} {s['stock_name']} | "
                     f"Score: {s['skill_score']}")

        # 儲存分析結果
        analysis_output = {
            "generated_at": analysis_date,
            "twse_candidates": twse_top,
            "tpex_candidates": tpex_top,
        }
        save_json(analysis_output, "skill_analysis_latest.json")

        if d1:
            d1.upsert_skill_analysis(analysis_date, twse_top + tpex_top)

    # 4. 儲存股票清單
    twse_stocks = info_fetcher.fetch_twse_stocks()
    tpex_stocks = info_fetcher.fetch_tpex_stocks()

    if not twse_stocks.empty:
        save_json(twse_stocks.head(1000).to_dict(orient="records"), "twse_stocks.json")
    if not tpex_stocks.empty:
        save_json(tpex_stocks.head(1000).to_dict(orient="records"), "tpex_stocks.json")

    log.info("\n" + "=" * 60)
    log.info("MSH 爬蟲執行完成")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
