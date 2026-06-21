/**
 * MSH - 股權分散表大股東籌碼分析 API
 * Cloudflare Workers Backend
 */

export interface Env {
  DB: D1Database;
  CACHE?: KVNamespace;
  FINMIND_TOKEN?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: CORS_HEADERS,
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// ─── TWSE / TPEX Price Fetcher (免費 OpenAPI，無需 Token) ────────────────────

const TWSE_PRICE_API = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const TPEX_PRICE_API = "https://www.tpex.org.tw/openapi/v1/exchangeReport/DAILY_CLOSE_QUOTES";

interface PriceInfo {
  close: number;
  change: number;
  change_pct: number;
}

async function fetchTwsePrices(): Promise<Map<string, PriceInfo>> {
  const result = new Map<string, PriceInfo>();
  try {
    const res = await fetch(TWSE_PRICE_API, {
      headers: { "User-Agent": "MSH-API/2.0", "Cache-Control": "no-cache" },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!res.ok) return result;
    const data = await res.json() as Array<{
      Code: string; ClosingPrice: string; Change: string;
    }>;
    for (const row of data) {
      const close = parseFloat(row.ClosingPrice?.replace(/,/g, "") || "0");
      const change = parseFloat(row.Change?.replace(/[+,]/g, "") || "0");
      const prev = close - change;
      const change_pct = prev > 0 ? Math.round((change / prev) * 10000) / 100 : 0;
      if (close > 0 && row.Code) {
        result.set(row.Code.trim(), { close, change: Math.round(change * 100) / 100, change_pct });
      }
    }
  } catch (e) {
    console.error("fetchTwsePrices error:", e);
  }
  return result;
}

async function fetchTpexPrices(codes?: string[]): Promise<Map<string, PriceInfo>> {
  const result = new Map<string, PriceInfo>();
  if (!codes || codes.length === 0) return result;
  try {
    // Yahoo Finance v8 single-stock API works from CF Workers; fetch in parallel batches
    const PARALLEL = 10; // max concurrent requests
    for (let i = 0; i < codes.length; i += PARALLEL) {
      const batch = codes.slice(i, i + PARALLEL);
      const promises = batch.map(async (code) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.TWO?interval=1d&range=5d`;
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MSH-API/2.0)' },
            cf: { cacheTtl: 60, cacheEverything: true },
          });
          if (!res.ok) return;
          const data = await res.json() as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; regularMarketChange?: number; regularMarketChangePercent?: number; previousClose?: number; chartPreviousClose?: number } }> } };
          const meta = data.chart?.result?.[0]?.meta;
          if (!meta) return;
          const close = meta.regularMarketPrice || 0;
          const prevClose = meta.previousClose || meta.chartPreviousClose || 0;
          const rawChange = prevClose > 0 ? (close - prevClose) : (meta.regularMarketChange || 0);
          const change = Math.round(rawChange * 100) / 100;
          const rawPct = prevClose > 0 ? (rawChange / prevClose * 100) : (meta.regularMarketChangePercent || 0);
          const change_pct = Math.round(rawPct * 100) / 100;
          if (close > 0) result.set(code, { close, change, change_pct });
        } catch (_e) { /* skip failed code */ }
      });
      await Promise.all(promises);
    }
  } catch (e) {
    console.error('fetchTpexPrices error:', e);
  }
  return result;
}
async function initDb(env: Env): Promise<void> {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS screener_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_date TEXT NOT NULL,
        market TEXT NOT NULL,
        stock_code TEXT NOT NULL,
        stock_name TEXT,
        industry TEXT,
        score REAL,
        total_change REAL,
        latest_ratio REAL,
        latest_change REAL,
        close_price REAL,
        change_pct REAL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
    await env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_screener_date ON screener_snapshots(snapshot_date)
    `).run();
  } catch(e) {
    console.error("initDb error:", e);
  }
}

// ─── handleBigHolderChanges ──────────────────────────────────────────────────
async function handleBigHolderChanges(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const market = url.searchParams.get("market") || "all";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 5000);
  const sort = url.searchParams.get("sort") || "total_change";
  const weeks = Math.min(parseInt(url.searchParams.get("weeks") || "6"), 12);
  const includePrice = url.searchParams.get("include_price") === "1";
  const industryFilter = url.searchParams.get("industry") || "";
  const etfOnly = url.searchParams.get("etf_only") === "1";

  const cacheKey = `bigholderchanges:v3:${market}:${limit}:${sort}:${weeks}:${includePrice ? "p" : "np"}:${industryFilter}:${etfOnly ? "etf" : ""}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });

  try {
    const datesResult = await env.DB.prepare(`SELECT DISTINCT date FROM holder_distribution ORDER BY date DESC LIMIT ${weeks + 1}`).all();
    const allDates = (datesResult.results || []).map((r: Record<string, unknown>) => r.date as string).sort();
    if (allDates.length < 2) return jsonResponse({ meta: { market, weeks: allDates.length, dates: allDates }, data: [] });

    const weekDates = allDates.slice(-(weeks));
    const prevDate = allDates.length > weeks ? allDates[allDates.length - weeks - 1] : allDates[0];
    const allNeeded = [...new Set([prevDate, ...weekDates])];
    const datesList = allNeeded.map(d => `'${d}'`).join(",");

    // ETF detection: starts with 0
    let etfFilter = "";
    if (etfOnly) {
      etfFilter = "AND (hd.stock_code LIKE '0%')";
    } else if (market !== "etf") {
      etfFilter = "AND (hd.stock_code NOT LIKE '0%')";
    }

    let marketFilter = "";
    if (market === "twse") {
      marketFilter = `AND (si.market = 'twse' OR (COALESCE(si.market, '') = '' AND hd.stock_code NOT LIKE '0%' AND CAST(hd.stock_code AS INTEGER) BETWEEN 1000 AND 9999))`;
    } else if (market === "tpex") {
      marketFilter = `AND (si.market = 'tpex' OR (COALESCE(si.market, '') = '' AND (CAST(hd.stock_code AS INTEGER) >= 4000 OR hd.stock_code GLOB '[4-9][0-9][0-9][0-9]')))`;
    } else if (market === "etf") {
      marketFilter = "";
      etfFilter = "AND hd.stock_code LIKE '0%'";
    }

    const indFilter = industryFilter ? `AND si.industry = '${industryFilter.replace(/'/g, "''")}'` : "";

    const sql = `
      SELECT hd.stock_code, si.stock_name, si.market, si.industry, hd.date,
        SUM(CASE WHEN CAST(hd.bracket AS INTEGER) >= 10 AND CAST(hd.bracket AS INTEGER) != 17 THEN hd.ratio ELSE 0 END) as big_holder_ratio
      FROM holder_distribution hd
      LEFT JOIN stock_info si ON hd.stock_code = si.stock_code
      WHERE hd.date IN (${datesList})
      ${marketFilter} ${etfFilter} ${indFilter}
      GROUP BY hd.stock_code, hd.date
      ORDER BY hd.stock_code, hd.date ASC
    `;

    const rawResult = await env.DB.prepare(sql).all();
    const rawRows = rawResult.results || [];

    type StockEntry = { stock_code: string; stock_name: string; market: string; industry: string; ratioByDate: Record<string, number> };
    const stockMap = new Map<string, StockEntry>();
    for (const rawRow of rawRows) {
      const row = rawRow as { stock_code: string; stock_name: string; market: string; industry: string; date: string; big_holder_ratio: number };
      const code = row.stock_code;
      if (!stockMap.has(code)) stockMap.set(code, { stock_code: code, stock_name: row.stock_name || "", market: row.market || "", industry: row.industry || "", ratioByDate: {} });
      const entry = stockMap.get(code) as StockEntry;
      entry.ratioByDate[row.date] = Math.round((row.big_holder_ratio || 0) * 100) / 100;
    }

    const latestDate = weekDates[weekDates.length - 1];
    const result: Array<{ stock_code: string; stock_name: string; market: string; industry: string; week_changes: Record<string, number | null>; total_change: number; latest_change: number; latest_ratio: number; week_dates: string[] }> = [];

    for (const [, stock] of stockMap) {
      if (!stock.ratioByDate[latestDate]) continue;
      const weekChanges: Record<string, number | null> = {};
      let totalChange = 0;
      for (let i = 0; i < weekDates.length; i++) {
        const d = weekDates[i];
        const curr = stock.ratioByDate[d] ?? null;
        const prev = i === 0 ? (stock.ratioByDate[prevDate] ?? null) : (stock.ratioByDate[weekDates[i - 1]] ?? null);
        if (curr !== null && prev !== null) {
          const change = Math.round((curr - prev) * 100) / 100;
          weekChanges[d] = change;
          totalChange += change;
        } else weekChanges[d] = null;
      }
      result.push({ stock_code: stock.stock_code, stock_name: stock.stock_name, market: stock.market, industry: stock.industry, week_changes: weekChanges, total_change: Math.round(totalChange * 100) / 100, latest_change: weekChanges[latestDate] || 0, latest_ratio: stock.ratioByDate[latestDate] || 0, week_dates: weekDates });
    }

    if (sort === "latest_change") result.sort((a, b) => b.latest_change - a.latest_change);
    else result.sort((a, b) => b.total_change - a.total_change);
    const topResult = result.slice(0, limit);

    let priceMap = new Map<string, PriceInfo>();
    if (includePrice) {
      try {
        // Step 1: Load prices from D1 stock_prices table (covers TWSE stocks from scheduled job)
        const priceRows = await env.DB.prepare(
          'SELECT stock_code, close, change, change_pct FROM stock_prices ORDER BY trade_date DESC'
        ).all();
        for (const row of priceRows.results || []) {
          const r = row as { stock_code: string; close: number; change: number; change_pct: number };
          if (r.close > 0 && !priceMap.has(r.stock_code)) priceMap.set(r.stock_code, { close: r.close, change: r.change, change_pct: r.change_pct });
        }
        // Step 2: Fetch TPEX prices live from Yahoo Finance v8 for stocks not in D1
        const tpexCodes = topResult
          .filter((r: { market?: string; stock_code: string }) => r.market === 'tpex' && !priceMap.has(r.stock_code))
          .map((r: { stock_code: string }) => r.stock_code);
        if (tpexCodes.length > 0) {
          const tpexPrices = await fetchTpexPrices(tpexCodes);
          for (const [k, v] of tpexPrices) priceMap.set(k, v);
        }
      } catch (e) { console.error("price fetch error:", e); }
    }
    const finalData = topResult.map(r => ({ ...r, price: priceMap.get(r.stock_code) || null }));
    const responseData = { meta: { market, limit, sort, weeks: weekDates.length, week_dates: weekDates, count: finalData.length, generated_at: new Date().toISOString() }, data: finalData };
    const responseText = JSON.stringify(responseData);
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 1800 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("handleBigHolderChanges error:", err);
    return errorResponse("Database query failed", 500);
  }
}

// ─── handleIndustries ────────────────────────────────────────────────────────
async function handleIndustries(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const market = url.searchParams.get("market") || "";
  const cacheKey = `industries:${market}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });
  try {
    const excludeList = ['ETF','ETN','Index','上櫃ETF','上櫃指數股票型基金(ETF)','指數投資證券(ETN)','受益證券','大盤','存託憑證','創新板股票','所有證券','其他'];
    const excludeSQL = excludeList.map(() => "?").join(",");
    let sql: string;
    const params: string[] = [...excludeList];
    if (market === "twse") sql = `SELECT DISTINCT industry FROM stock_info WHERE market = 'twse' AND COALESCE(industry,'') != '' AND industry NOT IN (${excludeSQL}) ORDER BY industry ASC`;
    else if (market === "tpex") sql = `SELECT DISTINCT industry FROM stock_info WHERE market = 'tpex' AND COALESCE(industry,'') != '' AND industry NOT IN (${excludeSQL}) ORDER BY industry ASC`;
    else sql = `SELECT DISTINCT industry FROM stock_info WHERE COALESCE(industry,'') != '' AND industry NOT IN (${excludeSQL}) ORDER BY industry ASC`;
    const result = await env.DB.prepare(sql).bind(...params).all();
    const industries = (result.results || []).map((r: Record<string, unknown>) => r.industry as string).filter(Boolean);
    const responseText = JSON.stringify({ market, industries });
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 86400 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) { return errorResponse("Query failed", 500); }
}

// ─── handleStats ──────────────────────────────────────────────────────────────
async function handleStats(env: Env): Promise<Response> {
  try {
    const sql = `SELECT (SELECT COUNT(DISTINCT stock_code) FROM holder_distribution) as total_stocks, (SELECT COUNT(DISTINCT date) FROM holder_distribution) as total_weeks, (SELECT MAX(date) FROM holder_distribution) as latest_date, (SELECT MIN(date) FROM holder_distribution) as earliest_date`;
    const result = await env.DB.prepare(sql).first();
    return jsonResponse({ data: result });
  } catch (err) { return errorResponse("Stats query failed", 500); }
}

// ─── handleDistribution ──────────────────────────────────────────────────────
async function handleDistribution(request: Request, env: Env, stockCode: string): Promise<Response> {
  if (!stockCode || !/^[0-9A-Z]{4,8}$/.test(stockCode)) return errorResponse("Invalid stock code");
  const cacheKey = `dist:${stockCode}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });
  try {
    const sql = `SELECT hd.date, hd.bracket, hd.holders, hd.shares, hd.ratio, si.stock_name FROM holder_distribution hd LEFT JOIN stock_info si ON hd.stock_code = si.stock_code WHERE hd.stock_code = ? AND hd.date IN (SELECT DISTINCT date FROM holder_distribution WHERE stock_code = ? ORDER BY date DESC LIMIT 12) ORDER BY hd.date DESC, hd.bracket ASC`;
    const result = await env.DB.prepare(sql).bind(stockCode, stockCode).all();
    const byDate: Record<string, unknown[]> = {};
    let stockName = "";
    for (const row of result.results || []) {
      const r = row as Record<string, unknown>;
      const d = r.date as string;
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(r);
      if (!stockName && r.stock_name) stockName = r.stock_name as string;
    }
    const weeks = Object.entries(byDate).sort(([a], [b]) => b.localeCompare(a)).map(([date, brackets]) => ({ date, brackets }));
    const responseData = { stock_code: stockCode, stock_name: stockName, weeks_count: weeks.length, data: weeks };
    const responseText = JSON.stringify(responseData);
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 1800 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) { return errorResponse("Database query failed", 500); }
}

// ─── handleTopChanges ────────────────────────────────────────────────────────
async function handleTopChanges(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "increase";
  const market = url.searchParams.get("market") || "all";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);
  const cacheKey = `topchanges:v3:${type}:${market}:${limit}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });
  try {
    const datesResult = await env.DB.prepare(`SELECT DISTINCT date FROM holder_distribution ORDER BY date DESC LIMIT 3`).all();
    const allDates = (datesResult.results || []).map((r: Record<string, unknown>) => r.date as string).sort();
    if (allDates.length < 2) return jsonResponse({ meta: { type, market, limit, count: 0 }, data: [] });
    const latestDate = allDates[allDates.length - 1];
    const prevDate = allDates[allDates.length - 2];
    let marketFilter = "";
    if (market === "twse") marketFilter = `AND (si.market = 'twse' OR (COALESCE(si.market, '') = '' AND hd.stock_code NOT LIKE '0%' AND CAST(hd.stock_code AS INTEGER) BETWEEN 1000 AND 9999))`;
    else if (market === "tpex") marketFilter = `AND (si.market = 'tpex' OR (COALESCE(si.market, '') = '' AND CAST(hd.stock_code AS INTEGER) >= 4000))`;
    else if (market === "etf") marketFilter = "AND hd.stock_code LIKE '0%'";
    else marketFilter = "AND hd.stock_code NOT LIKE '0%'";
    const sql = `SELECT hd.stock_code, si.stock_name, si.market, si.industry, hd.date, SUM(CASE WHEN CAST(hd.bracket AS INTEGER) >= 10 AND CAST(hd.bracket AS INTEGER) != 17 THEN hd.ratio ELSE 0 END) as big_holder_ratio FROM holder_distribution hd LEFT JOIN stock_info si ON hd.stock_code = si.stock_code WHERE hd.date IN ('${latestDate}', '${prevDate}') ${marketFilter} GROUP BY hd.stock_code, hd.date ORDER BY hd.stock_code, hd.date ASC`;
    const rawResult = await env.DB.prepare(sql).all();
    const byStock = new Map<string, { info: Record<string, string>; prev: number; curr: number }>();
    for (const r of rawResult.results || []) {
      const row = r as { stock_code: string; stock_name: string; market: string; industry: string; date: string; big_holder_ratio: number };
      if (!byStock.has(row.stock_code)) byStock.set(row.stock_code, { info: { stock_name: row.stock_name || "", market: row.market || "", industry: row.industry || "" }, prev: 0, curr: 0 });
      const entry = byStock.get(row.stock_code)!;
      if (row.date === prevDate) entry.prev = row.big_holder_ratio || 0;
      else if (row.date === latestDate) entry.curr = row.big_holder_ratio || 0;
    }
    const changes = [];
    for (const [code, entry] of byStock) {
      if (entry.curr === 0) continue;
      const change = Math.round((entry.curr - entry.prev) * 100) / 100;
      changes.push({ stock_code: code, ...entry.info, latest_week_change: change, latest_ratio: entry.curr, analysis_date: latestDate });
    }
    if (type === "increase") changes.sort((a, b) => b.latest_week_change - a.latest_week_change);
    else changes.sort((a, b) => a.latest_week_change - b.latest_week_change);
    const topData = changes.slice(0, limit);
    const responseData = { meta: { type, market, limit, count: topData.length }, data: topData };
    const responseText = JSON.stringify(responseData);
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 3600 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) { return errorResponse("Database query failed", 500); }
}

// ─── handleSearch ─────────────────────────────────────────────────────────────
async function handleSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  if (q.length < 1) return errorResponse("Query too short");
  try {
    const sql = `SELECT stock_code, stock_name, market, industry FROM stock_info WHERE stock_code LIKE ? OR stock_name LIKE ? LIMIT 20`;
    const pattern = `%${q}%`;
    const result = await env.DB.prepare(sql).bind(pattern, pattern).all();
    return jsonResponse({ data: result.results || [] });
  } catch (err) { return errorResponse("Search failed", 500); }
}

// ─── handleScreenerSnapshot (POST) ──────────────────────────────────────────
async function handleScreenerSnapshot(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method Not Allowed", 405);
  await initDb(env);
  try {
    const body = await request.json() as {
      snapshot_date: string;
      market: string;
      stocks: Array<{
        stock_code: string; stock_name?: string; industry?: string;
        score: number; total_change: number; latest_ratio: number;
        latest_change: number; close_price?: number; change_pct?: number;
      }>;
    };
    if (!body.snapshot_date || !body.stocks?.length) return errorResponse("snapshot_date and stocks required");

    // Delete existing snapshot for same date+market to allow re-save
    await env.DB.prepare("DELETE FROM screener_snapshots WHERE snapshot_date = ? AND market = ?").bind(body.snapshot_date, body.market).run();

    const stmts: D1PreparedStatement[] = [];
    for (const s of body.stocks) {
      stmts.push(env.DB.prepare(
        "INSERT INTO screener_snapshots (snapshot_date, market, stock_code, stock_name, industry, score, total_change, latest_ratio, latest_change, close_price, change_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(body.snapshot_date, body.market, s.stock_code, s.stock_name || "", s.industry || "", s.score, s.total_change, s.latest_ratio, s.latest_change, s.close_price || null, s.change_pct || null));
    }
    const results = await env.DB.batch(stmts);
    const inserted = results.filter(r => r.success).length;
    return jsonResponse({ success: true, message: `儲存 ${inserted} 筆起漲潛力標的`, snapshot_date: body.snapshot_date, market: body.market, inserted });
  } catch (err) {
    console.error("handleScreenerSnapshot error:", err);
    return errorResponse("Failed to save snapshot: " + String(err), 500);
  }
}

// ─── handleScreenerHistory (GET) ─────────────────────────────────────────────
async function handleScreenerHistory(request: Request, env: Env): Promise<Response> {
  await initDb(env);
  const url = new URL(request.url);
  const market = url.searchParams.get("market") || "all";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
  const date = url.searchParams.get("date") || "";
  const stockCode = url.searchParams.get("stock_code") || "";
  try {
    let sql = "SELECT * FROM screener_snapshots";
    const params: (string | number)[] = [];
    const conditions: string[] = [];
    if (market !== "all") { conditions.push("market = ?"); params.push(market); }
    if (date) { conditions.push("snapshot_date = ?"); params.push(date); }
    if (stockCode) { conditions.push("stock_code = ?"); params.push(stockCode); }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY snapshot_date DESC, score DESC LIMIT ?";
    params.push(limit);
    const result = await env.DB.prepare(sql).bind(...params).all();
    // Get distinct dates for summary
    const datesSql = "SELECT DISTINCT snapshot_date, market, COUNT(*) as count FROM screener_snapshots GROUP BY snapshot_date, market ORDER BY snapshot_date DESC LIMIT 20";
    const datesResult = await env.DB.prepare(datesSql).all();
    return jsonResponse({
      meta: { market, count: (result.results || []).length },
      dates: datesResult.results || [],
      data: result.results || [],
    });
  } catch (err) {
    console.error("handleScreenerHistory error:", err);
    return errorResponse("Failed to query history: " + String(err), 500);
  }
}

// ─── handleUploadCsv ─────────────────────────────────────────────────────────
async function handleUploadCsv(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data") && !contentType.includes("text/csv") && !contentType.includes("application/octet-stream")) {
    return jsonResponse({ error: "請以 multipart/form-data 上傳 CSV" }, 400);
  }
  let csvText = "", dateParam = "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") return jsonResponse({ error: "找不到 'file' 欄位" }, 400);
    csvText = await (file as File).text();
    dateParam = (formData.get("date") as string) || "";
  } else {
    csvText = await request.text();
    const url = new URL(request.url);
    dateParam = url.searchParams.get("date") || "";
  }
  if (!csvText.trim()) return jsonResponse({ error: "CSV 內容為空" }, 400);
  const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim());
  const firstCells = lines[0].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
  return handleTdccCsv(lines, firstCells, dateParam, env);
}

async function handleTdccCsv(lines: string[], firstCells: string[], dateParam: string, env: Env): Promise<Response> {
  const rows = lines.map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
  const firstCell = (firstCells[0] || "").trim();
  const isHeader = !/^[0-9A-Za-z]{3,8}$/.test(firstCell);
  const dataRows = isHeader ? rows.slice(1) : rows;
  const header = isHeader ? rows[0].map(h => h.toLowerCase()) : [];
  let dateCol = -1, stockCol = 0, bracketCol = 1, holdersCol = 2, sharesCol = 3, ratioCol = 4;
  if (isHeader) {
    const findCol = (names: string[]) => names.reduce<number>((f, n) => f >= 0 ? f : header.findIndex(h => h.includes(n)), -1);
    const d = findCol(["date", "日期", "scadate"]); const s = findCol(["stock_code", "證券代號", "code", "股票"]);
    const b = findCol(["bracket", "持股", "分級"]); const h = findCol(["holders", "人數"]);
    const sh = findCol(["shares", "股數", "單位數"]); const r = findCol(["ratio", "比例", "佔", "%"]);
    if (d >= 0) dateCol = d; if (s >= 0) stockCol = s; if (b >= 0) bracketCol = b;
    if (h >= 0) holdersCol = h; if (sh >= 0) sharesCol = sh; if (r >= 0) ratioCol = r;
  } else if (/^\d{8}$/.test(firstCell)) { dateCol = 0; stockCol = 1; bracketCol = 2; holdersCol = 3; sharesCol = 4; ratioCol = 5; }
  let isoDate = dateParam;
  if (!isoDate && dataRows.length > 0 && dateCol >= 0) {
    const v = (dataRows[0][dateCol] || "").trim();
    if (/^\d{8}$/.test(v)) isoDate = v;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) isoDate = v;
  }
  if (!isoDate) isoDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let inserted = 0, skipped = 0, errors = 0;
  try { await env.DB.prepare("DELETE FROM distributions WHERE date = ?").bind(isoDate).run(); } catch(e) { console.error("DELETE error:", e); }
  let firstError = "";
  const BATCH = 100;
  for (let i = 0; i < dataRows.length; i += BATCH) {
    const batch = dataRows.slice(i, i + BATCH);
    if (!batch.length) continue;
    const stmts: D1PreparedStatement[] = [];
    let batchSkipped = 0;
    for (const row of batch) {
      const minCols = Math.max(stockCol, bracketCol, holdersCol, sharesCol, ratioCol) + 1;
      if (row.length < minCols) { skipped++; batchSkipped++; continue; }
      const code = (row[stockCol] || "").replace(/\s/g, "").substring(0, 10);
      if (!code || !/^[0-9A-Za-z]{3,8}$/.test(code)) { skipped++; batchSkipped++; continue; }
      let rowDate = isoDate;
      if (dateCol >= 0 && row[dateCol]) { const raw = row[dateCol].trim(); if (/^\d{8}$/.test(raw)) rowDate = raw; else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) rowDate = raw; }
      const bracket = (row[bracketCol] || "").substring(0, 50);
      const holders = parseInt((row[holdersCol] || "0").replace(/,/g, "")) || 0;
      const shares = parseInt((row[sharesCol] || "0").replace(/,/g, "")) || 0;
      const ratio = parseFloat((row[ratioCol] || "0").replace(/,/g, "")) || 0;
      stmts.push(env.DB.prepare("INSERT INTO distributions (stock_code, date, bracket, holders, shares, ratio) VALUES (?,?,?,?,?,?)").bind(code, rowDate, bracket, holders, shares, ratio));
    }
    if (!stmts.length) continue;
    try {
      const results = await env.DB.batch(stmts);
      const ok = results.filter(r => r.success).length;
      inserted += ok; errors += stmts.length - ok;
    } catch(e) { if (!firstError) firstError = e instanceof Error ? e.message : String(e); errors += stmts.length; }
  }
  if (env.CACHE) {
    await env.CACHE.delete(`bigholderchanges:v3:twse:5000:total_change:6:p::`);
    await env.CACHE.delete(`bigholderchanges:v3:tpex:5000:total_change:6:p::`);
    await env.CACHE.delete(`bigholderchanges:v3:all:5000:total_change:6:p::`);
  }
  return jsonResponse({ success: inserted > 0, source: "tdcc", message: `TDCC：匯入 ${inserted} 筆，略過 ${skipped} 筆，失敗 ${errors} 筆`, date: isoDate, total_rows: dataRows.length, inserted, skipped, errors, ...(firstError ? { first_error: firstError } : {}) });
}

// ─── handleStockDetail ──────────────────────────────────────────────────────
async function handleStockDetail(request: Request, env: Env, stockCode: string): Promise<Response> {
  if (!stockCode || !/^[0-9A-Z]{4,8}$/i.test(stockCode)) return errorResponse("Invalid stock code");
  const code = stockCode.toUpperCase();
  const cacheKey = `stockdetail:v1:${code}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });
  try {
    const datesResult = await env.DB.prepare("SELECT DISTINCT date FROM holder_distribution ORDER BY date DESC LIMIT 13").all();
    const allDates = (datesResult.results || []).map((r: Record<string, unknown>) => r.date as string).sort();
    if (allDates.length < 2) return errorResponse("Insufficient data", 404);
    const weekDates = allDates.slice(-12);
    const prevDate = allDates.length > 12 ? allDates[allDates.length - 13] : allDates[0];
    const allNeeded = [...new Set([prevDate, ...weekDates])];
    const datesList = allNeeded.map(d => `'${d}'`).join(",");
    const sql = `
      SELECT hd.date,
        SUM(CASE WHEN CAST(hd.bracket AS INTEGER) >= 10 AND CAST(hd.bracket AS INTEGER) != 17 THEN hd.ratio ELSE 0 END) as big_holder_ratio,
        SUM(CASE WHEN CAST(hd.bracket AS INTEGER) BETWEEN 4 AND 9 THEN hd.ratio ELSE 0 END) as mid_holder_ratio,
        SUM(CASE WHEN CAST(hd.bracket AS INTEGER) BETWEEN 1 AND 3 THEN hd.ratio ELSE 0 END) as small_holder_ratio,
        SUM(CASE WHEN CAST(hd.bracket AS INTEGER) = 17 THEN hd.holders ELSE 0 END) as total_holders,
        si.stock_name, si.market, si.industry
      FROM holder_distribution hd
      LEFT JOIN stock_info si ON hd.stock_code = si.stock_code
      WHERE hd.stock_code = ? AND hd.date IN (${datesList})
      GROUP BY hd.date
      ORDER BY hd.date ASC
    `;
    const result = await env.DB.prepare(sql).bind(code).all();
    const rows = result.results as Array<{ date: string; big_holder_ratio: number; mid_holder_ratio: number; small_holder_ratio: number; total_holders: number; stock_name: string; market: string; industry: string }>;
    if (!rows.length) return errorResponse("Stock not found", 404);
    const stockName = rows[0]?.stock_name || "";
    const market = rows[0]?.market || "";
    const industry = rows[0]?.industry || "";
    const latestRow = rows[rows.length - 1];
    const prevRow = rows.find(r => r.date === prevDate) || rows[0];
    const big_holder_trend = Math.round(((latestRow.big_holder_ratio || 0) - (prevRow?.big_holder_ratio || 0)) * 100) / 100;
    const mid_holder_trend = Math.round(((latestRow.mid_holder_ratio || 0) - (prevRow?.mid_holder_ratio || 0)) * 100) / 100;
    const small_holder_trend = Math.round(((latestRow.small_holder_ratio || 0) - (prevRow?.small_holder_ratio || 0)) * 100) / 100;
    const total_holders = latestRow.total_holders || 0;
    let price = null;
    try {
      // First try D1 stock_prices table (covers both TWSE and TPEX from scheduled job)
      const priceRow = await env.DB.prepare(
        'SELECT close, change, change_pct FROM stock_prices WHERE stock_code = ? ORDER BY trade_date DESC LIMIT 1'
      ).bind(code).first() as { close: number; change: number; change_pct: number } | null;
      if (priceRow && priceRow.close > 0) {
        price = { close: priceRow.close, change: priceRow.change, change_pct: priceRow.change_pct };
      } else {
        // Fall back to live TWSE API (for TWSE stocks not yet in D1)
        const twsePrices = await fetchTwsePrices();
        price = twsePrices.get(code) || null;
        // If still not found and looks like TPEX code range, try Yahoo Finance
        if (!price && /^[456789]/.test(code)) {
          const tpexPrices = await fetchTpexPrices([code]);
          price = tpexPrices.get(code) || null;
        }
      }
    } catch(e) { console.error('price fetch for stock detail error:', e); }
    const responseData = {
      stock_code: code, stock_name: stockName, market, industry,
      big_holder_trend, mid_holder_trend, small_holder_trend, total_holders,
      latest_ratio: latestRow.big_holder_ratio || 0,
      price,
      week_dates: weekDates,
      weekly_ratios: rows.map(r => ({ date: r.date, big: r.big_holder_ratio, mid: r.mid_holder_ratio, small: r.small_holder_ratio }))
    };
    const responseText = JSON.stringify(responseData);
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 1800 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("handleStockDetail error:", err);
    return errorResponse("Database query failed", 500);
  }
}

// ─── handleAllStocks ──────────────────────────────────────────────────────────
async function handleAllStocks(env: Env): Promise<Response> {
  const cacheKey = 'allstocks:v1';
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });
  try {
    const result = await env.DB.prepare("SELECT DISTINCT stock_code FROM holder_distribution WHERE stock_code NOT LIKE '0%' ORDER BY stock_code ASC").all();
    const stocks = (result.results || []).map((r: Record<string, unknown>) => ({ stock_code: r.stock_code as string }));
    const responseText = JSON.stringify({ count: stocks.length, stocks });
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 3600 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) {
    return errorResponse("Query failed", 500);
  }
}

// ─── handleUpsertStock (POST) ────────────────────────────────────────────────
// Upsert bracket data for a specific stock on specific dates
// Body: { stock_code: string, dates: { [date: string]: { bracket: number, holders: number, shares: number, ratio: number }[] } }
async function handleUpsertStock(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method Not Allowed", 405);
  try {
    const body = await request.json() as {
      stock_code: string;
      dates: Record<string, Array<{ bracket: number; holders: number; shares: number; ratio: number }>>;
    };
    if (!body.stock_code || !body.dates) return errorResponse("stock_code and dates required");
    const code = body.stock_code.trim().toUpperCase();
    if (!/^[0-9A-Z]{3,8}$/.test(code)) return errorResponse("Invalid stock code");

    const stmts: D1PreparedStatement[] = [];
    let total = 0;
    for (const [date, brackets] of Object.entries(body.dates)) {
      if (!/^\d{8}$/.test(date)) continue;
      for (const b of brackets) {
        stmts.push(env.DB.prepare(
          "INSERT OR REPLACE INTO distributions (stock_code, date, bracket, holders, shares, ratio) VALUES (?,?,?,?,?,?)"
        ).bind(code, date, String(b.bracket), b.holders, b.shares, b.ratio));
        total++;
      }
    }
    if (!stmts.length) return errorResponse("No valid data to insert");
    const results = await env.DB.batch(stmts);
    const inserted = results.filter(r => r.success).length;
    // Invalidate cache for this stock
    if (env.CACHE) {
      await env.CACHE.delete(`dist:${code}`);
      await env.CACHE.delete(`stockdetail:v1:${code}`);
      // Also clear big-holder-changes caches
      for (const market of ['twse','tpex','all']) {
        for (const sfx of ['6','12']) {
          await env.CACHE.delete(`bigholderchanges:v3:${market}:5000:total_change:${sfx}:p::`);
          await env.CACHE.delete(`bigholderchanges:v3:${market}:5000:total_change:${sfx}:np::`);
        }
      }
    }
    return jsonResponse({ success: true, stock_code: code, total_stmts: total, inserted, errors: total - inserted });
  } catch (err) {
    console.error("handleUpsertStock error:", err);
    return errorResponse("Upsert failed: " + String(err), 500);
  }
}


// ─── handleFixDates (POST) ───────────────────────────────────────────────────
// Fix date format: convert "YYYY-MM-DD" → "YYYYMMDD" in distributions table
async function handleFixDates(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method Not Allowed", 405);
  try {
    // Find all bad-format dates (YYYY-MM-DD)
    const badDates = await env.DB.prepare(
      "SELECT DISTINCT date FROM distributions WHERE date LIKE '____-__-__'"
    ).all();
    const badDateList = (badDates.results || []).map((r: Record<string, unknown>) => r.date as string);
    if (!badDateList.length) return jsonResponse({ success: true, message: "No bad dates found", fixed: 0 });

    let fixed = 0, deleted = 0, errors = 0;
    for (const badDate of badDateList) {
      const goodDate = badDate.replace(/-/g, '');
      const existing = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM distributions WHERE date = ?"
      ).bind(goodDate).first() as { cnt: number } | null;
      
      if (existing && existing.cnt > 0) {
        const del = await env.DB.prepare(
          "DELETE FROM distributions WHERE date = ?"
        ).bind(badDate).run();
        deleted += del.meta?.changes || 0;
      } else {
        const upd = await env.DB.prepare(
          "UPDATE distributions SET date = ? WHERE date = ?"
        ).bind(goodDate, badDate).run();
        fixed += upd.meta?.changes || 0;
      }
    }
    
    if (env.CACHE) {
      await env.CACHE.delete('allstocks:v1');
      for (const market of ['twse','tpex','all']) {
        for (const sfx of ['6','12']) {
          await env.CACHE.delete(`bigholderchanges:v3:${market}:5000:total_change:${sfx}:p::`);
          await env.CACHE.delete(`bigholderchanges:v3:${market}:5000:total_change:${sfx}:np::`);
        }
      }
    }
    return jsonResponse({ success: true, bad_dates: badDateList, fixed, deleted, errors });
  } catch (err) {
    console.error("handleFixDates error:", err);
    return errorResponse("Fix dates failed: " + String(err), 500);
  }
}

// ─── handleSupplementNorway (POST) ──────────────────────────────────────────
// Bulk supplement missing week data from norway.twsthr.info TopWeek scrape
// Body: { stocks: [{code, r0508, r0515, r0522, r0529}], force?: boolean }
async function handleSupplementNorway(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return errorResponse("Method Not Allowed", 405);
  try {
    const body = await request.json() as {
      stocks: Array<{ code: string; r0508: number; r0515: number; r0522: number; r0529: number }>;
      force?: boolean;
    };
    if (!body.stocks?.length) return errorResponse("stocks array required");
    const force = body.force || false;
    const targetDates = ['20260508', '20260515', '20260522', '20260529'];
    
    let processed = 0, skipped = 0, errors = 0;
    const allStmts: D1PreparedStatement[] = [];
    
    for (const stock of body.stocks) {
      const code = (stock.code || '').trim().toUpperCase();
      if (!code || !/^[0-9A-Z]{3,8}$/.test(code)) { errors++; continue; }
      const ratios: Record<string, number> = {
        '20260508': stock.r0508 || 0,
        '20260515': stock.r0515 || 0,
        '20260522': stock.r0522 || 0,
        '20260529': stock.r0529 || 0,
      };
      
      if (!force) {
        const dateList = targetDates.map(d => "'" + d + "'").join(',');
        const existing = await env.DB.prepare(
          `SELECT date, SUM(CASE WHEN CAST(bracket AS INTEGER) >= 10 AND bracket != '17' THEN ratio ELSE 0 END) as big_ratio
           FROM distributions WHERE stock_code = ? AND date IN (${dateList}) GROUP BY date`
        ).bind(code).all();
        const rows = existing.results as Array<{date: string; big_ratio: number}>;
        if (rows.length >= 3) {
          const vals = rows.map(r => Math.round((r.big_ratio || 0) * 100));
          const allSame = vals.length > 1 && vals.every(v => v === vals[0]);
          const allNonZero = vals.every(v => v > 0);
          if (!allSame && allNonZero) { skipped++; continue; }
        }
      }
      
      for (const date of targetDates) {
        const ratio = ratios[date];
        if (!ratio || ratio <= 0) continue;
        allStmts.push(env.DB.prepare("DELETE FROM distributions WHERE stock_code = ? AND date = ?").bind(code, date));
        allStmts.push(env.DB.prepare(
          "INSERT OR REPLACE INTO distributions (stock_code, date, bracket, holders, shares, ratio) VALUES (?,?,?,?,?,?)"
        ).bind(code, date, '10', 0, 0, ratio));
        allStmts.push(env.DB.prepare(
          "INSERT OR REPLACE INTO distributions (stock_code, date, bracket, holders, shares, ratio) VALUES (?,?,?,?,?,?)"
        ).bind(code, date, '17', 0, 0, 100));
      }
      processed++;
    }
    
    let inserted = 0;
    const BATCH = 90;
    for (let i = 0; i < allStmts.length; i += BATCH) {
      try {
        const results = await env.DB.batch(allStmts.slice(i, i + BATCH));
        inserted += results.filter(r => r.success).length;
      } catch (e) { errors++; }
    }
    
    if (env.CACHE) {
      for (const market of ['twse','tpex','all']) {
        for (const sfx of ['6','12']) {
          await env.CACHE.delete(`bigholderchanges:v3:${market}:5000:total_change:${sfx}:p::`);
          await env.CACHE.delete(`bigholderchanges:v3:${market}:5000:total_change:${sfx}:np::`);
          await env.CACHE.delete(`bigholderchanges:v3:${market}:5000:latest_change:${sfx}:p::`);
          await env.CACHE.delete(`bigholderchanges:v3:${market}:5000:latest_change:${sfx}:np::`);
        }
      }
      await env.CACHE.delete('allstocks:v1');
      for (const t of ['increase','decrease']) {
        for (const m of ['twse','tpex','all']) {
          await env.CACHE.delete(`topchanges:v3:${t}:${m}:50`);
        }
      }
    }
    
    return jsonResponse({ 
      success: true, 
      total_stocks: body.stocks.length,
      processed, skipped, errors,
      stmts_count: allStmts.length,
      inserted
    });
  } catch (err) {
    console.error("handleSupplementNorway error:", err);
    return errorResponse("Supplement failed: " + String(err), 500);
  }
}

// ─── Stock Prices Table ────────────────────────────────────────────────────
async function initPricesDb(env: Env): Promise<void> {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS stock_prices (
        stock_code TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        close REAL,
        change REAL,
        change_pct REAL,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (stock_code, trade_date)
      )
    `).run();
  } catch(e) {
    console.error("initPricesDb error:", e);
  }
}

// ─── handleFetchAndSavePrices ────────────────────────────────────────────────
// Fetch TWSE + TPEX prices and save to stock_prices table
// Uses TWSE MI_INDEX to get actual trade date (not today's calendar date)
async function handleFetchAndSavePrices(env: Env): Promise<{ success: boolean; message: string; trade_date?: string; saved?: number }> {
  try {
    await initPricesDb(env);

    // ── Step 1: Get actual trade date from APIs ──────────────────────────────
    // Strategy: fetch TPEX (has CDate per row) or TWSE MI_INDEX, validate <= today TW
    const now0 = new Date();
    const twNow0 = new Date(now0.getTime() + 8 * 3600000);
    const todayTW = twNow0.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD today in TW
    const twHour = twNow0.getUTCHours(); // hour in TW time
    let tradeDate = '';

    // Try TPEX first — it often has CDate in each row: "2026/06/15"
    try {
      const tpexRes = await fetch('https://www.tpex.org.tw/openapi/v1/exchangeReport/DAILY_CLOSE_QUOTES', {
        headers: { 'User-Agent': 'MSH-API/2.0', 'Cache-Control': 'no-cache' },
        cf: { cacheTtl: 0, cacheEverything: false },
      });
      if (tpexRes.ok) {
        const tpexData = await tpexRes.json() as Array<{ CDate?: string; SecuritiesCompanyCode?: string }>;
        if (Array.isArray(tpexData) && tpexData.length > 0) {
          const cdateRaw = tpexData[0].CDate || '';
          // CDate format: "2026/06/15" → "20260615"
          const d = cdateRaw.replace(/\//g, '');
          if (/^\d{8}$/.test(d) && d <= todayTW) {
            tradeDate = d;
            console.log('Got trade date from TPEX CDate:', tradeDate);
          }
        }
      }
    } catch (e) { console.warn('TPEX date fetch failed:', e); }

    // Try TWSE MI_INDEX if TPEX failed
    if (!tradeDate) {
      try {
        const miRes = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX', {
          headers: { 'User-Agent': 'MSH-API/2.0', 'Cache-Control': 'no-cache' },
          cf: { cacheTtl: 0, cacheEverything: false },
        });
        if (miRes.ok) {
          const miData = await miRes.json() as Array<{ Date?: string }>;
          if (Array.isArray(miData) && miData.length > 0 && miData[0].Date) {
            const d = String(miData[0].Date).replace(/\//g, '');
            if (/^\d{8}$/.test(d) && d <= todayTW) {
              tradeDate = d;
              console.log('Got trade date from MI_INDEX:', tradeDate);
            }
          }
        }
      } catch (e) { console.warn('MI_INDEX fetch failed:', e); }
    }

    // Fallback: use yesterday TW if after 14:00 TW (market closed), else day before
    if (!tradeDate) {
      // Use today if market may be open (before 14:00 TW), else use yesterday
      const offsetDays = twHour >= 14 ? 0 : -1;
      const fallback = new Date(twNow0.getTime() + offsetDays * 86400000);
      tradeDate = fallback.toISOString().slice(0, 10).replace(/-/g, '');
      // Skip weekends: if Saturday(6) use Friday, if Sunday(0) use Friday
      const dow = fallback.getUTCDay();
      if (dow === 6) tradeDate = new Date(fallback.getTime() - 86400000).toISOString().slice(0, 10).replace(/-/g, '');
      if (dow === 0) tradeDate = new Date(fallback.getTime() - 2 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
      console.log('Using fallback trade date:', tradeDate);
    }

    console.log('Final trade date:', tradeDate, 'Today TW:', todayTW);

        // ── Step 2: Fetch prices from TWSE + TPEX ────────────────────────────────
    // Get tpex stock codes for Yahoo Finance fetch
    const tpexCodesResult = await env.DB.prepare(
      "SELECT DISTINCT stock_code FROM stock_info WHERE market = 'tpex' LIMIT 500"
    ).all();
    const allTpexCodes = (tpexCodesResult.results || []).map((r: { stock_code: string }) => r.stock_code);
    const [twsePrices, tpexPrices] = await Promise.all([fetchTwsePrices(), fetchTpexPrices(allTpexCodes)]);
    const allPrices = new Map<string, PriceInfo>();
    for (const [k, v] of twsePrices) allPrices.set(k, v);
    for (const [k, v] of tpexPrices) allPrices.set(k, v);
    if (allPrices.size === 0) return { success: false, message: 'No price data fetched (market may be closed)' };

    // ── Step 3: Batch insert into D1 ─────────────────────────────────────────
    const stmts: D1PreparedStatement[] = [];
    for (const [code, p] of allPrices) {
      stmts.push(env.DB.prepare(
        'INSERT OR REPLACE INTO stock_prices (stock_code, trade_date, close, change, change_pct, updated_at) VALUES (?,?,?,?,?,datetime(\'now\'))'
      ).bind(code, tradeDate, p.close, p.change, p.change_pct));
    }
    let saved = 0;
    const BATCH = 200;
    for (let i = 0; i < stmts.length; i += BATCH) {
      const results = await env.DB.batch(stmts.slice(i, i + BATCH));
      saved += results.filter(r => r.success).length;
    }

        // ── Step 3b: Clean up stale entries stored under wrong calendar date ─────────
    // todayTW is computed in Step 1; if actual trade date differs, delete wrong entries
    if (todayTW !== tradeDate) {
      try {
        await env.DB.prepare('DELETE FROM stock_prices WHERE trade_date != ?').bind(tradeDate).run();
        console.log('Deleted stale entries for calendar date ' + todayTW);
      } catch (e) { console.warn('Cleanup stale dates failed:', e); }
    }

// ── Step 4: Invalidate KV cache ──────────────────────────────────────────
    if (env.CACHE) {
      await env.CACHE.delete('prices:latest');
      await env.CACHE.delete('prices:date');
    }
    console.log(`Prices saved: ${saved} stocks for ${tradeDate}`);
    return { success: true, message: `Saved ${saved} prices for ${tradeDate}`, trade_date: tradeDate, saved };
  } catch (err) {
    console.error("handleFetchAndSavePrices error:", err);
    return { success: false, message: String(err) };
  }
}

// ─── handleGetPrices ─────────────────────────────────────────────────────────
// GET /api/prices?codes=2330,2317&date=20260615
async function handleGetPrices(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date') || '';
  const codesParam = url.searchParams.get('codes') || '';
  const cacheKey = 'prices:latest';
  if (!codesParam && !dateParam) {
    const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
    if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, 'X-Cache': 'HIT' } });
  }
  try {
    await initPricesDb(env);
    let tradeDate = dateParam;
    if (!tradeDate) {
      const latest = await env.DB.prepare(
        'SELECT trade_date FROM stock_prices ORDER BY trade_date DESC LIMIT 1'
      ).first() as { trade_date: string } | null;
      tradeDate = latest?.trade_date || '';
    }
    if (!tradeDate) return jsonResponse({ trade_date: null, count: 0, data: {} });
    let sql: string;
    let params: (string | number)[];
    if (codesParam) {
      const codes = codesParam.split(',').map((c: string) => c.trim()).filter(Boolean).slice(0, 500);
      const placeholders = codes.map(() => '?').join(',');
      sql = `SELECT stock_code, close, change, change_pct FROM stock_prices WHERE trade_date = ? AND stock_code IN (${placeholders})`;
      params = [tradeDate, ...codes];
    } else {
      sql = 'SELECT stock_code, close, change, change_pct FROM stock_prices WHERE trade_date = ?';
      params = [tradeDate];
    }
    const result = await env.DB.prepare(sql).bind(...params).all();
    const priceMap: Record<string, { close: number; change: number; change_pct: number }> = {};
    for (const row of result.results || []) {
      const r = row as { stock_code: string; close: number; change: number; change_pct: number };
      priceMap[r.stock_code] = { close: r.close, change: r.change, change_pct: r.change_pct };
    }
    const responseData = { trade_date: tradeDate, count: Object.keys(priceMap).length, data: priceMap };
    const text = JSON.stringify(responseData);
    if (!codesParam && !dateParam && env.CACHE) {
      await env.CACHE.put(cacheKey, text, { expirationTtl: 3600 });
    }
    return new Response(text, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("handleGetPrices error:", err);
    return errorResponse("Prices query failed", 500);
  }
}

// ─── handleRefreshPrices (POST) ──────────────────────────────────────────────
// Manual trigger for price refresh
async function handleRefreshPrices(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405);
  const result = await handleFetchAndSavePrices(env);
  return jsonResponse(result);
}

// ─── Main Router ─────────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/api/big-holder-changes" || path === "/api/big-holder-changes/") return handleBigHolderChanges(request, env);
    if (path === "/api/top-changes" || path === "/api/top-changes/") return handleTopChanges(request, env);
    if (path === "/api/search" || path === "/api/search/") return handleSearch(request, env);
    if (path === "/api/stats" || path === "/api/stats/") return handleStats(env);
    if (path === "/api/upload-csv" || path === "/api/upload-csv/") return handleUploadCsv(request, env);
    if (path === "/api/industries" || path === "/api/industries/") return handleIndustries(request, env);
    if (path === "/api/screener-snapshot" || path === "/api/screener-snapshot/") return handleScreenerSnapshot(request, env);
    if (path === "/api/screener-history" || path === "/api/screener-history/") return handleScreenerHistory(request, env);
    const distMatch = path.match(/^\/api\/distribution\/([A-Z0-9]+)$/i);
  const stockMatch = path.match(/^\/api\/stock\/([A-Z0-9]+)$/i);
  if (stockMatch) return handleStockDetail(request, env, stockMatch[1]);
  if (path === "/api/all-stocks" || path === "/api/all-stocks/") return handleAllStocks(env);
  if (path === "/api/upsert-stock" || path === "/api/upsert-stock/") return handleUpsertStock(request, env);
    if (path === "/api/fix-dates" || path === "/api/fix-dates/") return handleFixDates(request, env);
    if (path === "/api/supplement-norway" || path === "/api/supplement-norway/") return handleSupplementNorway(request, env);
    if (distMatch) return handleDistribution(request, env, distMatch[1].toUpperCase());
    if (path === "/" || path === "/api") {
      return jsonResponse({
        service: "MSH API", version: "3.0.0",
        description: "股權分散表大股東籌碼分析 API",
        endpoints: [
          "GET /api/big-holder-changes?market=twse|tpex|etf|all&limit=5000&sort=total_change&weeks=6&include_price=1&industry=&etf_only=0",
          "GET /api/distribution/:stockCode",
          "GET /api/top-changes?type=increase|decrease&market=twse|tpex|etf|all&limit=20",
          "GET /api/search?q=keyword",
          "GET /api/stats",
          "GET /api/industries?market=twse|tpex",
          "POST /api/upload-csv (multipart/form-data: file, date?)",
          "POST /api/screener-snapshot {snapshot_date, market, stocks:[]}",
          "GET /api/screener-history?market=all&date=&stock_code=&limit=100",
        ],
      });
    }
        if (path === "/api/prices" || path === "/api/prices/") return handleGetPrices(request, env);
    if (path === "/api/refresh-prices" || path === "/api/refresh-prices/") return handleRefreshPrices(request, env);
    return errorResponse("Not found", 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await handleFetchAndSavePrices(env);
  }
,};
