-- MSH Stock Analysis Database Schema
-- Cloudflare D1 (SQLite)
-- Run: wrangler d1 execute msh-stock-db --file=schema.sql

-- ─── Stock Info ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_info (
      stock_code    TEXT PRIMARY KEY,
      stock_name    TEXT NOT NULL DEFAULT '',
      market        TEXT NOT NULL DEFAULT '',  -- 'twse' | 'tpex'
    industry      TEXT DEFAULT '',
      pe_ratio      REAL DEFAULT NULL,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE INDEX IF NOT EXISTS idx_stock_info_market ON stock_info(market);
CREATE INDEX IF NOT EXISTS idx_stock_info_name ON stock_info(stock_name);

-- ─── Holder Distribution ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holder_distribution (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_code  TEXT NOT NULL,
      date        TEXT NOT NULL,   -- YYYY-MM-DD
    bracket     TEXT NOT NULL,   -- e.g. '400,001以上', '1-999', '合計'
    holders     INTEGER NOT NULL DEFAULT 0,
      shares      INTEGER NOT NULL DEFAULT 0,
      ratio       REAL    NOT NULL DEFAULT 0.0,
      UNIQUE(stock_code, date, bracket)
  );

CREATE INDEX IF NOT EXISTS idx_hd_stock_date ON holder_distribution(stock_code, date);
CREATE INDEX IF NOT EXISTS idx_hd_date ON holder_distribution(date);
CREATE INDEX IF NOT EXISTS idx_hd_bracket ON holder_distribution(bracket);

-- ─── Skill Analysis ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_analysis (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_code          TEXT NOT NULL,
      analysis_date       TEXT NOT NULL,  -- YYYY-MM-DD
    skill_score         REAL DEFAULT 0,
      big_holder_ratio    REAL DEFAULT 0, -- latest big holder %
    big_holder_trend    REAL DEFAULT 0, -- cumulative change over analyzed weeks
    retail_trend        REAL DEFAULT 0, -- retail holder % change (negative = good)
    holder_change       INTEGER DEFAULT 0, -- total holder count change
    latest_week_change  REAL DEFAULT 0, -- single week big holder change
    alert               INTEGER DEFAULT 0, -- 1 = surge alert
    UNIQUE(stock_code, analysis_date)
  );

CREATE INDEX IF NOT EXISTS idx_sa_date ON skill_analysis(analysis_date);
CREATE INDEX IF NOT EXISTS idx_sa_score ON skill_analysis(skill_score DESC);
CREATE INDEX IF NOT EXISTS idx_sa_alert ON skill_analysis(alert);

-- ─── Views ───────────────────────────────────────────────────────────────────

-- Latest analysis view
CREATE VIEW IF NOT EXISTS latest_skill_analysis AS
SELECT sa.*, si.stock_name, si.market, si.industry
FROM skill_analysis sa
LEFT JOIN stock_info si ON sa.stock_code = si.stock_code
WHERE sa.analysis_date = (SELECT MAX(analysis_date) FROM skill_analysis)
ORDER BY sa.skill_score DESC;

-- TWSE top candidates
CREATE VIEW IF NOT EXISTS twse_top_candidates AS
SELECT * FROM latest_skill_analysis
WHERE CAST(stock_code AS INTEGER) BETWEEN 1000 AND 3999
ORDER BY skill_score DESC
LIMIT 20;

-- TPEX top candidates
CREATE VIEW IF NOT EXISTS tpex_top_candidates AS
SELECT * FROM latest_skill_analysis
WHERE CAST(stock_code AS INTEGER) >= 4000
ORDER BY skill_score DESC
LIMIT 20;
