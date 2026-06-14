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
      headers: { "User-Agent": "MSH-API/2.0" },
      cf: { cacheTtl: 3600 },
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

async function fetchTpexPrices(): Promise<Map<string, PriceInfo>> {
  const result = new Map<string, PriceInfo>();
  try {
    const res = await fetch(TPEX_PRICE_API, {
      headers: { "User-Agent": "MSH-API/2.0" },
      cf: { cacheTtl: 3600 },
    });
    if (!res.ok) return result;
    const data = await res.json() as Array<{
      SecuritiesCompanyCode: string; Close: string; Change: string;
    }>;
    for (const row of data) {
      const close = parseFloat(row.Close?.replace(/,/g, "") || "0");
      const change = parseFloat(row.Change?.replace(/[+,]/g, "") || "0");
      const prev = close - change;
      const change_pct = prev > 0 ? Math.round((change / prev) * 10000) / 100 : 0;
      const code = (row.SecuritiesCompanyCode || "").trim();
      if (close > 0 && code) {
        result.set(code, { close, change: Math.round(change * 100) / 100, change_pct });
      }
    }
  } catch (e) {
    console.error("fetchTpexPrices error:", e);
  }
  return result;
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

/**
 * GET /api/big-holder-changes
 */
async function handleBigHolderChanges(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const market = url.searchParams.get("market") || "all";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 5000);
  const sort = url.searchParams.get("sort") || "total_change";
  const weeks = Math.min(parseInt(url.searchParams.get("weeks") || "6"), 12);
  const includePrice = url.searchParams.get("include_price") === "1";
  const industryFilter = url.searchParams.get("industry") || "";

  // Cache key excludes finmind_token since we use TWSE OpenAPI now
  const cacheKey = `bigholderchanges:v2:${market}:${limit}:${sort}:${weeks}:${includePrice ? "p" : "np"}:${industryFilter}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });

  try {
    const datesResult = await env.DB.prepare(`
      SELECT DISTINCT date FROM holder_distribution
      ORDER BY date DESC LIMIT ${weeks + 1}
    `).all();

    const allDates = (datesResult.results || []).map(
      (r: Record<string, unknown>) => r.date as string
    ).sort();
    if (allDates.length < 2) {
      return jsonResponse({ meta: { market, weeks: allDates.length, dates: allDates }, data: [] });
    }

    const weekDates = allDates.slice(-(weeks));
    const prevDate = allDates.length > weeks ? allDates[allDates.length - weeks - 1] : allDates[0];
    const allNeeded = [...new Set([prevDate, ...weekDates])];
    const datesList = allNeeded.map(d => `'${d}'`).join(",");

    let marketFilter = "";
    if (market === "twse") {
      marketFilter = `AND (si.market = 'twse' OR (COALESCE(si.market, '') = '' AND hd.stock_code NOT LIKE '0%' AND CAST(hd.stock_code AS INTEGER) BETWEEN 1000 AND 9999))`;
    } else if (market === "tpex") {
      marketFilter = `AND (si.market = 'tpex' OR (COALESCE(si.market, '') = '' AND (CAST(hd.stock_code AS INTEGER) >= 4000 OR hd.stock_code GLOB '[4-9][0-9][0-9][0-9]')))`;
    }

    const indFilter = industryFilter ? `AND si.industry = '${industryFilter.replace(/'/g, "''")}'` : "";

    const sql = `
      SELECT
        hd.stock_code,
        si.stock_name,
        si.market,
        si.industry,
        hd.date,
        SUM(CASE WHEN CAST(hd.bracket AS INTEGER) >= 10 AND CAST(hd.bracket AS INTEGER) != 17 THEN hd.ratio ELSE 0 END) as big_holder_ratio
      FROM holder_distribution hd
      LEFT JOIN stock_info si ON hd.stock_code = si.stock_code
      WHERE hd.date IN (${datesList})
      ${marketFilter}
      ${indFilter}
      GROUP BY hd.stock_code, hd.date
      ORDER BY hd.stock_code, hd.date ASC
    `;

    const rawResult = await env.DB.prepare(sql).all();
    const rawRows = rawResult.results || [];

    type StockEntry = {
      stock_code: string;
      stock_name: string;
      market: string;
      industry: string;
      ratioByDate: Record<string, number>;
    };
    const stockMap = new Map<string, StockEntry>();

    for (const rawRow of rawRows) {
      const row = rawRow as {
        stock_code: string; stock_name: string; market: string;
        industry: string; date: string; big_holder_ratio: number;
      };
      const code = row.stock_code;
      if (!stockMap.has(code)) {
        stockMap.set(code, {
          stock_code: code,
          stock_name: row.stock_name || "",
          market: row.market || "",
          industry: row.industry || "",
          ratioByDate: {},
        });
      }
      const entry = stockMap.get(code) as StockEntry;
      entry.ratioByDate[row.date] = Math.round((row.big_holder_ratio || 0) * 100) / 100;
    }

    const latestDate = weekDates[weekDates.length - 1];
    const result: Array<{
      stock_code: string; stock_name: string; market: string; industry: string;
      week_changes: Record<string, number | null>;
      total_change: number; latest_change: number; latest_ratio: number;
      week_dates: string[];
    }> = [];

    for (const [, stock] of stockMap) {
      if (!stock.ratioByDate[latestDate]) continue;
      const weekChanges: Record<string, number | null> = {};
      let totalChange = 0;
      for (let i = 0; i < weekDates.length; i++) {
        const d = weekDates[i];
        const curr = stock.ratioByDate[d] ?? null;
        const prev = i === 0
          ? (stock.ratioByDate[prevDate] ?? null)
          : (stock.ratioByDate[weekDates[i - 1]] ?? null);
        if (curr !== null && prev !== null) {
          const change = Math.round((curr - prev) * 100) / 100;
          weekChanges[d] = change;
          totalChange += change;
        } else {
          weekChanges[d] = null;
        }
      }
      totalChange = Math.round(totalChange * 100) / 100;
      result.push({
        stock_code: stock.stock_code,
        stock_name: stock.stock_name,
        market: stock.market,
        industry: stock.industry,
        week_changes: weekChanges,
        total_change: totalChange,
        latest_change: weekChanges[latestDate] || 0,
        latest_ratio: stock.ratioByDate[latestDate] || 0,
        week_dates: weekDates,
      });
    }

    if (sort === "latest_change") {
      result.sort((a, b) => b.latest_change - a.latest_change);
    } else {
      result.sort((a, b) => b.total_change - a.total_change);
    }

    const topResult = result.slice(0, limit);

    // Fetch prices from TWSE/TPEX OpenAPI (free, no token needed)
    let priceMap = new Map<string, PriceInfo>();
    if (includePrice) {
      try {
        const [twsePrices, tpexPrices] = await Promise.all([
          fetchTwsePrices(),
          fetchTpexPrices(),
        ]);
        for (const [k, v] of twsePrices) priceMap.set(k, v);
        for (const [k, v] of tpexPrices) priceMap.set(k, v);
      } catch (e) {
        console.error("price fetch error:", e);
      }
    }

    const finalData = topResult.map(r => ({
      ...r,
      price: priceMap.get(r.stock_code) || null,
    }));

    const responseData = {
      meta: {
        market, limit, sort,
        weeks: weekDates.length,
        week_dates: weekDates,
        count: finalData.length,
        generated_at: new Date().toISOString(),
      },
      data: finalData,
    };
    const responseText = JSON.stringify(responseData);
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 1800 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("handleBigHolderChanges error:", err);
    return errorResponse("Database query failed", 500);
  }
}

/**
 * GET /api/industries?market=twse|tpex
 */
async function handleIndustries(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const market = url.searchParams.get("market") || "";

  const cacheKey = `industries:${market}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });

  try {
    const excludeList = [
      'ETF','ETN','Index','上櫃ETF','上櫃指數股票型基金(ETF)','指數投資證券(ETN)',
      '受益證券','大盤','存託憑證','創新板股票','所有證券','其他'
    ];
    const excludeSQL = excludeList.map(() => "?").join(",");

    let sql: string;
    const params: string[] = [...excludeList];

    if (market === "twse") {
      sql = `SELECT DISTINCT industry FROM stock_info WHERE market = 'twse' AND COALESCE(industry,'') != '' AND industry NOT IN (${excludeSQL}) ORDER BY industry ASC`;
    } else if (market === "tpex") {
      sql = `SELECT DISTINCT industry FROM stock_info WHERE market = 'tpex' AND COALESCE(industry,'') != '' AND industry NOT IN (${excludeSQL}) ORDER BY industry ASC`;
    } else {
      sql = `SELECT DISTINCT industry FROM stock_info WHERE COALESCE(industry,'') != '' AND industry NOT IN (${excludeSQL}) ORDER BY industry ASC`;
    }

    const result = await env.DB.prepare(sql).bind(...params).all();
    const industries = (result.results || []).map((r: Record<string, unknown>) => r.industry as string).filter(Boolean);
    const responseText = JSON.stringify({ market, industries });
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 86400 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("handleIndustries error:", err);
    return errorResponse("Query failed", 500);
  }
}

/**
 * GET /api/stats
 */
async function handleStats(env: Env): Promise<Response> {
  try {
    const sql = `
      SELECT
        (SELECT COUNT(DISTINCT stock_code) FROM holder_distribution) as total_stocks,
        (SELECT COUNT(DISTINCT date) FROM holder_distribution) as total_weeks,
        (SELECT MAX(date) FROM holder_distribution) as latest_date,
        (SELECT MIN(date) FROM holder_distribution) as earliest_date
    `;
    const result = await env.DB.prepare(sql).first();
    return jsonResponse({ data: result });
  } catch (err) {
    return errorResponse("Stats query failed", 500);
  }
}

/**
 * GET /api/distribution/:stockCode
 */
async function handleDistribution(request: Request, env: Env, stockCode: string): Promise<Response> {
  if (!stockCode || !/^[0-9A-Z]{4,8}$/.test(stockCode)) return errorResponse("Invalid stock code");

  const cacheKey = `dist:${stockCode}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });

  try {
    const sql = `
      SELECT hd.date, hd.bracket, hd.holders, hd.shares, hd.ratio, si.stock_name
      FROM holder_distribution hd
      LEFT JOIN stock_info si ON hd.stock_code = si.stock_code
      WHERE hd.stock_code = ?
      AND hd.date IN (
        SELECT DISTINCT date FROM holder_distribution
        WHERE stock_code = ? ORDER BY date DESC LIMIT 12
      )
      ORDER BY hd.date DESC, hd.bracket ASC
    `;
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
    const weeks = Object.entries(byDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, brackets]) => ({ date, brackets }));
    const responseData = { stock_code: stockCode, stock_name: stockName, weeks_count: weeks.length, data: weeks };
    const responseText = JSON.stringify(responseData);
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 1800 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("handleDistribution error:", err);
    return errorResponse("Database query failed", 500);
  }
}

/**
 * GET /api/top-changes
 */
async function handleTopChanges(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "increase";
  const market = url.searchParams.get("market") || "all";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);
  const weeks = Math.min(parseInt(url.searchParams.get("weeks") || "1"), 4);

  const cacheKey = `topchanges:v2:${type}:${market}:${limit}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });

  try {
    // Use big-holder-changes logic to get top changes
    const datesResult = await env.DB.prepare(`
      SELECT DISTINCT date FROM holder_distribution
      ORDER BY date DESC LIMIT 3
    `).all();

    const allDates = (datesResult.results || []).map(
      (r: Record<string, unknown>) => r.date as string
    ).sort();

    if (allDates.length < 2) {
      return jsonResponse({ meta: { type, market, limit, count: 0 }, data: [] });
    }

    const latestDate = allDates[allDates.length - 1];
    const prevDate = allDates[allDates.length - 2];

    let marketFilter = "";
    if (market === "twse") {
      marketFilter = `AND (si.market = 'twse' OR (COALESCE(si.market, '') = '' AND hd.stock_code NOT LIKE '0%' AND CAST(hd.stock_code AS INTEGER) BETWEEN 1000 AND 9999))`;
    } else if (market === "tpex") {
      marketFilter = `AND (si.market = 'tpex' OR (COALESCE(si.market, '') = '' AND CAST(hd.stock_code AS INTEGER) >= 4000))`;
    }

    const sql = `
      SELECT
        hd.stock_code,
        si.stock_name,
        si.market,
        si.industry,
        hd.date,
        SUM(CASE WHEN CAST(hd.bracket AS INTEGER) >= 10 AND CAST(hd.bracket AS INTEGER) != 17 THEN hd.ratio ELSE 0 END) as big_holder_ratio
      FROM holder_distribution hd
      LEFT JOIN stock_info si ON hd.stock_code = si.stock_code
      WHERE hd.date IN ('${latestDate}', '${prevDate}')
      ${marketFilter}
      GROUP BY hd.stock_code, hd.date
      ORDER BY hd.stock_code, hd.date ASC
    `;

    const rawResult = await env.DB.prepare(sql).all();
    const byStock = new Map<string, { info: Record<string, string>; prev: number; curr: number }>();

    for (const r of rawResult.results || []) {
      const row = r as { stock_code: string; stock_name: string; market: string; industry: string; date: string; big_holder_ratio: number };
      if (!byStock.has(row.stock_code)) {
        byStock.set(row.stock_code, { info: { stock_name: row.stock_name || "", market: row.market || "", industry: row.industry || "" }, prev: 0, curr: 0 });
      }
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

    if (type === "increase") {
      changes.sort((a, b) => b.latest_week_change - a.latest_week_change);
    } else {
      changes.sort((a, b) => a.latest_week_change - b.latest_week_change);
    }

    const topData = changes.slice(0, limit);
    const responseData = {
      meta: { type, market, limit, count: topData.length },
      data: topData,
    };
    const responseText = JSON.stringify(responseData);
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 3600 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("handleTopChanges error:", err);
    return errorResponse("Database query failed", 500);
  }
}

/**
 * GET /api/search?q=keyword
 */
async function handleSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  if (q.length < 1) return errorResponse("Query too short");
  try {
    const sql = `
      SELECT stock_code, stock_name, market, industry
      FROM stock_info
      WHERE stock_code LIKE ? OR stock_name LIKE ?
      LIMIT 20
    `;
    const pattern = `%${q}%`;
    const result = await env.DB.prepare(sql).bind(pattern, pattern).all();
    return jsonResponse({ data: result.results || [] });
  } catch (err) {
    return errorResponse("Search failed", 500);
  }
}

/**
 * POST /api/upload-csv
 */
async function handleUploadCsv(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  const contentType = request.headers.get("content-type") || "";
  if (
    !contentType.includes("multipart/form-data") &&
    !contentType.includes("text/csv") &&
    !contentType.includes("application/octet-stream")
  ) {
    return jsonResponse({ error: "請以 multipart/form-data 上傳 CSV" }, 400);
  }

  let csvText = "", dateParam = "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return jsonResponse({ error: "找不到 'file' 欄位" }, 400);
    }
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

async function handleTdccCsv(
  lines: string[],
  firstCells: string[],
  dateParam: string,
  env: Env
): Promise<Response> {
  const rows = lines.map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));

  const firstCell = (firstCells[0] || "").trim();
  const isHeader = !/^[0-9A-Za-z]{3,8}$/.test(firstCell);
  const dataRows = isHeader ? rows.slice(1) : rows;
  const header = isHeader ? rows[0].map(h => h.toLowerCase()) : [];

  let dateCol = -1, stockCol = 0, bracketCol = 1, holdersCol = 2, sharesCol = 3, ratioCol = 4;

  if (isHeader) {
    const findCol = (names: string[]) =>
      names.reduce<number>((f, n) => f >= 0 ? f : header.findIndex(h => h.includes(n)), -1);
    const d = findCol(["date", "日期", "scadate"]);
    const s = findCol(["stock_code", "證券代號", "code", "股票"]);
    const b = findCol(["bracket", "持股", "分級"]);
    const h = findCol(["holders", "人數"]);
    const sh = findCol(["shares", "股數", "單位數"]);
    const r = findCol(["ratio", "比例", "佔", "%"]);
    if (d >= 0) dateCol = d;
    if (s >= 0) stockCol = s;
    if (b >= 0) bracketCol = b;
    if (h >= 0) holdersCol = h;
    if (sh >= 0) sharesCol = sh;
    if (r >= 0) ratioCol = r;
  } else if (/^\d{8}$/.test(firstCell)) {
    dateCol = 0; stockCol = 1; bracketCol = 2; holdersCol = 3; sharesCol = 4; ratioCol = 5;
  }

  let isoDate = dateParam;
  if (!isoDate && dataRows.length > 0 && dateCol >= 0) {
    const v = (dataRows[0][dateCol] || "").trim();
      if (/^\d{8}$/.test(v)) isoDate = v;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) isoDate = v;
  }
  if (!isoDate) isoDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  let inserted = 0, skipped = 0, errors = 0;

  // Delete existing data for this date to ensure clean update
  try {
    await env.DB.prepare("DELETE FROM distributions WHERE date = ?").bind(isoDate).run();
  } catch(e) { console.error("DELETE error:", e); }
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
    if (dateCol >= 0 && row[dateCol]) {
      const raw = row[dateCol].trim();
      if (/^\d{8}$/.test(raw)) rowDate = raw;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) rowDate = raw;
    }

    const bracket = (row[bracketCol] || "").substring(0, 50);
    const holders = parseInt((row[holdersCol] || "0").replace(/,/g, "")) || 0;
    const shares = parseInt((row[sharesCol] || "0").replace(/,/g, "")) || 0;
    const ratio = parseFloat((row[ratioCol] || "0").replace(/,/g, "")) || 0;

    stmts.push(
      env.DB.prepare("INSERT INTO distributions (stock_code, date, bracket, holders, shares, ratio) VALUES (?,?,?,?,?,?)")
        .bind(code, rowDate, bracket, holders, shares, ratio)
    );
  }
  if (!stmts.length) continue;
  try {
    const results = await env.DB.batch(stmts);
    const ok = results.filter(r => r.success).length;
    inserted += ok;
    errors += stmts.length - ok;
  } catch(e) {
    if (!firstError) firstError = e instanceof Error ? e.message : String(e);
    errors += stmts.length;
  }
}

// Invalidate caches
  if (env.CACHE) {
    await env.CACHE.delete(`bigholderchanges:v2:twse:5000:total_change:6:p:`);
    await env.CACHE.delete(`bigholderchanges:v2:tpex:5000:total_change:6:p:`);
    await env.CACHE.delete(`bigholderchanges:v2:all:5000:total_change:6:p:`);
  }

  return jsonResponse({
    success: inserted > 0,
    source: "tdcc",
    message: `TDCC：匯入 ${inserted} 筆，略過 ${skipped} 筆，失敗 ${errors} 筆`,
    date: isoDate,
    total_rows: dataRows.length,
    inserted, skipped, errors,
    ...(firstError ? { first_error: firstError } : {}),
  });
}

// ─── Main Router ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/big-holder-changes" || path === "/api/big-holder-changes/")
      return handleBigHolderChanges(request, env);
    if (path === "/api/top-changes" || path === "/api/top-changes/")
      return handleTopChanges(request, env);
    if (path === "/api/search" || path === "/api/search/")
      return handleSearch(request, env);
    if (path === "/api/stats" || path === "/api/stats/")
      return handleStats(env);
    if (path === "/api/upload-csv" || path === "/api/upload-csv/")
      return handleUploadCsv(request, env);
    if (path === "/api/industries" || path === "/api/industries/")
      return handleIndustries(request, env);

    const distMatch = path.match(/^\/api\/distribution\/([A-Z0-9]+)$/i);
    if (distMatch) return handleDistribution(request, env, distMatch[1].toUpperCase());

    if (path === "/" || path === "/api") {
      return jsonResponse({
        service: "MSH API",
        version: "2.0.0",
        description: "股權分散表大股東籌碼分析 API",
        endpoints: [
          "GET /api/big-holder-changes?market=all&limit=5000&sort=total_change&weeks=6&include_price=1&industry=",
          "GET /api/distribution/:stockCode",
          "GET /api/top-changes?type=increase|decrease&market=all&limit=20",
          "GET /api/search?q=keyword",
          "GET /api/stats",
          "GET /api/industries?market=twse|tpex",
          "POST /api/upload-csv (multipart/form-data: file, date?)",
        ],
      });
    }

    return errorResponse("Not found", 404);
  },
};
