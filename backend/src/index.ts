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

// ─── FinMind API Helper ──────────────────────────────────────────────────────

const FINMIND_API = "https://api.finmindtrade.com/api/v4/data";

async function fetchFinMindPrice(
  token: string,
  stockCodes: string[],
  date: string
): Promise<Map<string, { close: number; change: number; change_pct: number }>> {
  const result = new Map<string, { close: number; change: number; change_pct: number }>();
  try {
    const url = new URL(FINMIND_API);
    url.searchParams.set("dataset", "TaiwanStockPrice");
    url.searchParams.set("start_date", date);
    url.searchParams.set("token", token);
    const res = await fetch(url.toString(), { headers: { "User-Agent": "MSH-API/1.0" } });
    if (!res.ok) return result;
    const json = (await res.json()) as { status: number; data: Array<{ stock_id: string; close: number; spread: number }> };
    if (json.status !== 200 || !Array.isArray(json.data)) return result;
    for (const row of json.data) {
      if (stockCodes.includes(row.stock_id)) {
        const change = row.spread ?? 0;
        const prev = row.close - change;
        const change_pct = prev !== 0 ? Math.round((change / prev) * 10000) / 100 : 0;
        result.set(row.stock_id, {
          close: row.close ?? 0,
          change: Math.round(change * 100) / 100,
          change_pct,
        });
      }
    }
  } catch (e) {
    console.error("fetchFinMindPrice error:", e);
  }
  return result;
}

async function fetchFinMindIndustry(
  token: string
): Promise<Map<string, { industry: string; market: string; name: string }>> {
  const result = new Map<string, { industry: string; market: string; name: string }>();
  try {
    const url = new URL(FINMIND_API);
    url.searchParams.set("dataset", "TaiwanStockInfo");
    url.searchParams.set("token", token);
    const res = await fetch(url.toString(), { headers: { "User-Agent": "MSH-API/1.0" } });
    if (!res.ok) return result;
    const json = (await res.json()) as {
      status: number;
      data: Array<{ stock_id: string; industry_category: string; type: string; stock_name: string }>;
    };
    if (json.status !== 200 || !Array.isArray(json.data)) return result;
    for (const row of json.data) {
      const market = row.type === "twse" || row.type === "上市" ? "twse" :
        row.type === "tpex" || row.type === "上櫃" ? "tpex" : row.type;
      result.set(row.stock_id, {
        industry: row.industry_category || "",
        market,
        name: row.stock_name || "",
      });
    }
  } catch (e) {
    console.error("fetchFinMindIndustry error:", e);
  }
  return result;
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

/**
 * GET /api/skill-analysis
 */
async function handleSkillAnalysis(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const market = url.searchParams.get("market") || "all";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);
  const date = url.searchParams.get("date");

  const cacheKey = `skill:${market}:${limit}:${date || "latest"}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });

  try {
    let marketFilter = "";
    if (market === "twse") {
      marketFilter = `AND CAST(sa.stock_code AS INTEGER) BETWEEN 1000 AND 9999 AND sa.stock_code NOT LIKE '0%'`;
    } else if (market === "tpex") {
      marketFilter = `AND CAST(sa.stock_code AS INTEGER) >= 4000`;
    }
    const dateFilter = date
      ? `AND sa.analysis_date = '${date}'`
      : `AND sa.analysis_date = (SELECT MAX(analysis_date) FROM skill_analysis)`;

    const sql = `
      SELECT sa.stock_code, si.stock_name, si.market, si.industry,
        sa.analysis_date, sa.skill_score, sa.big_holder_ratio,
        sa.big_holder_trend, sa.retail_trend, sa.holder_change,
        sa.latest_week_change, sa.alert
      FROM skill_analysis sa
      LEFT JOIN stock_info si ON sa.stock_code = si.stock_code
      WHERE 1=1 ${dateFilter} ${marketFilter}
      ORDER BY sa.skill_score DESC, sa.alert DESC
      LIMIT ${limit}
    `;
    const result = await env.DB.prepare(sql).all();
    const responseData = {
      meta: {
        market, limit,
        count: result.results?.length || 0,
        analysis_date: result.results?.[0]?.analysis_date || null,
        generated_at: new Date().toISOString(),
      },
      data: result.results || [],
    };
    const responseText = JSON.stringify(responseData);
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 3600 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("handleSkillAnalysis error:", err);
    return errorResponse("Database query failed", 500);
  }
}

/**
 * GET /api/big-holder-changes
 * 大股東持有比率週增減排行
 * week_changes values: number = actual change, null = no data for that week
 */
async function handleBigHolderChanges(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const market = url.searchParams.get("market") || "all";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 5000);
  const sort = url.searchParams.get("sort") || "total_change";
  const weeks = Math.min(parseInt(url.searchParams.get("weeks") || "6"), 12);
  const includePrice = url.searchParams.get("include_price") === "1";
  const industryFilter = url.searchParams.get("industry") || "";

  const cacheKey = `bigholderchanges:${market}:${limit}:${sort}:${weeks}:${includePrice ? "p" : "np"}:${industryFilter}`;
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

    // Market filter: use si.market if available, fallback to stock_code pattern
    let marketFilter = "";
    if (market === "twse") {
      marketFilter = `AND (si.market = 'twse' OR (COALESCE(si.market, '') = '' AND hd.stock_code NOT LIKE '0%' AND CAST(hd.stock_code AS INTEGER) BETWEEN 1000 AND 9999))`;
    } else if (market === "tpex") {
      marketFilter = `AND (si.market = 'tpex' OR (COALESCE(si.market, '') = '' AND (CAST(hd.stock_code AS INTEGER) >= 4000 OR hd.stock_code GLOB '[4-9][0-9][0-9][0-9]')))`;
    }

    // Industry filter
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

    type PriceInfo = { close: number; change: number; change_pct: number };
    let priceMap = new Map<string, PriceInfo>();
    if (includePrice && env.FINMIND_TOKEN) {
      const token = env.FINMIND_TOKEN;
      const stockCodes = topResult.map(r => r.stock_code);
      priceMap = await fetchFinMindPrice(token, stockCodes, latestDate);
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
 * GET /api/price?codes=2330,2317&date=2026-06-05
 */
async function handlePrice(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const codesParam = url.searchParams.get("codes") || "";
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);

  if (!codesParam) return errorResponse("codes parameter required");
  if (!env.FINMIND_TOKEN) return errorResponse("FINMIND_TOKEN not configured", 503);

  const codes = codesParam.split(",").map(c => c.trim()).filter(Boolean);
  const priceMap = await fetchFinMindPrice(env.FINMIND_TOKEN, codes, date);

  const data: Record<string, unknown> = {};
  for (const [k, v] of priceMap.entries()) data[k] = v;

  return jsonResponse({ date, data });
}

/**
 * GET /api/industries?market=twse|tpex
 * 回傳指定市場的產業類別清單
 */
async function handleIndustries(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const market = url.searchParams.get("market") || "";

  const cacheKey = `industries:${market}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });

  try {
    // Try reading from stock_info view first, fallback to stocks table
    let sql = "";
    if (market === "twse") sql = `SELECT DISTINCT industry FROM stock_info WHERE market = 'twse' AND COALESCE(industry,'') != '' ORDER BY industry ASC`;
    else if (market === "tpex") sql = `SELECT DISTINCT industry FROM stock_info WHERE market = 'tpex' AND COALESCE(industry,'') != '' ORDER BY industry ASC`;
    else sql = `SELECT DISTINCT industry FROM stock_info WHERE COALESCE(industry,'') != '' ORDER BY industry ASC`;

    const result = await env.DB.prepare(sql).all();
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
 * GET or POST /api/sync-industry
 * 從 FinMind 同步股票產業資訊到 D1
 */
async function handleSyncIndustry(request: Request, env: Env): Promise<Response> {
  if (!env.FINMIND_TOKEN) return errorResponse("FINMIND_TOKEN not configured", 503);

  try {
    const infoMap = await fetchFinMindIndustry(env.FINMIND_TOKEN);
    if (!infoMap.size) return errorResponse("No data from FinMind", 502);

    let updated = 0;
    const entries = Array.from(infoMap.entries());
    const BATCH = 50;

    // Try to determine if stock_info is a view or table
    // Use 'stocks' table (scraper schema) with fallback to stock_info
    let targetTable = "stocks";
    try {
      const check = await env.DB.prepare("SELECT name, type FROM sqlite_master WHERE name='stock_info' AND type='table'").first();
      if (check) targetTable = "stock_info";
    } catch {
      // ignore, use default
    }

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const stmts = batch.map(([code, info]) =>
        env.DB.prepare(`
          INSERT INTO ${targetTable} (stock_code, stock_name, market, industry)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(stock_code) DO UPDATE SET
            stock_name = CASE WHEN excluded.stock_name != '' THEN excluded.stock_name ELSE stock_name END,
            market = CASE WHEN excluded.market != '' THEN excluded.market ELSE market END,
            industry = CASE WHEN excluded.industry != '' THEN excluded.industry ELSE industry END,
            updated_at = datetime('now')
        `).bind(code, info.name, info.market, info.industry)
      );
      await env.DB.batch(stmts);
      updated += batch.length;
    }

    // Invalidate cached industries
    if (env.CACHE) {
      await env.CACHE.delete("industries:twse");
      await env.CACHE.delete("industries:tpex");
      await env.CACHE.delete("industries:");
    }

    return jsonResponse({ success: true, updated, table: targetTable, message: `已更新 ${updated} 筆股票資訊 (table: ${targetTable})` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("handleSyncIndustry error:", err);
    return errorResponse(`Sync failed: ${msg}`, 500);
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

  const cacheKey = `topchanges:${type}:${market}:${limit}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });

  try {
    const orderDir = type === "increase" ? "DESC" : "ASC";
    let marketFilter = "";
    if (market === "twse") marketFilter = `AND si.market = 'twse'`;
    else if (market === "tpex") marketFilter = `AND si.market = 'tpex'`;

    const sql = `
      SELECT sa.stock_code, si.stock_name, si.market,
        sa.big_holder_trend, sa.latest_week_change,
        sa.skill_score, sa.alert, sa.analysis_date
      FROM skill_analysis sa
      LEFT JOIN stock_info si ON sa.stock_code = si.stock_code
      WHERE sa.analysis_date = (SELECT MAX(analysis_date) FROM skill_analysis)
      ${marketFilter}
      ORDER BY sa.latest_week_change ${orderDir}
      LIMIT ${limit}
    `;
    const result = await env.DB.prepare(sql).all();
    const responseData = {
      meta: { type, market, limit, count: result.results?.length || 0 },
      data: result.results || [],
    };
    const responseText = JSON.stringify(responseData);
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 3600 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) {
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
 * GET /api/stats
 */
async function handleStats(env: Env): Promise<Response> {
  try {
    const sql = `
      SELECT
        (SELECT COUNT(DISTINCT stock_code) FROM holder_distribution) as total_stocks,
        (SELECT COUNT(DISTINCT date) FROM holder_distribution) as total_weeks,
        (SELECT MAX(date) FROM holder_distribution) as latest_date,
        (SELECT MIN(date) FROM holder_distribution) as earliest_date,
        (SELECT COUNT(*) FROM skill_analysis
          WHERE analysis_date = (SELECT MAX(analysis_date) FROM skill_analysis)
          AND alert = 1) as alert_count
    `;
    const result = await env.DB.prepare(sql).first();
    return jsonResponse({ data: result });
  } catch (err) {
    return errorResponse("Stats query failed", 500);
  }
}

// ─── CSV Upload ──────────────────────────────────────────────────────────────

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

  let csvText = "", dateParam = "", sourceHint = "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return jsonResponse({ error: "找不到 'file' 欄位" }, 400);
    }
    csvText = await (file as File).text();
    dateParam = (formData.get("date") as string) || "";
    sourceHint = ((formData.get("source") as string) || "").toLowerCase();
  } else {
    csvText = await request.text();
    const url = new URL(request.url);
    dateParam = url.searchParams.get("date") || "";
    sourceHint = (url.searchParams.get("source") || "").toLowerCase();
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

  const isHeader =
    !/^\d{8}$/.test(firstCells[0]) && !/^\d{4,6}$/.test(firstCells[0]);
  const dataRows = isHeader ? rows.slice(1) : rows;

  let dateCol = 0, stockCol = 1, bracketCol = 2, holdersCol = 3, sharesCol = 4, ratioCol = 5;
  if (isHeader) {
    const header = rows[0].map(h => h.toLowerCase());
    const findCol = (names: string[]) =>
      names.reduce<number>((f, n) => f >= 0 ? f : header.findIndex(h => h.includes(n)), -1);
    const d = findCol(["date", "日期", "scadate"]);
    const s = findCol(["stock_code", "證券代號", "code"]);
    const b = findCol(["bracket", "持股分級", "持股"]);
    const h = findCol(["holders", "人數"]);
    const sh = findCol(["shares", "股數"]);
    const r = findCol(["ratio", "比例", "佔"]);
    if (d >= 0) dateCol = d;
    if (s >= 0) stockCol = s;
    if (b >= 0) bracketCol = b;
    if (h >= 0) holdersCol = h;
    if (sh >= 0) sharesCol = sh;
    if (r >= 0) ratioCol = r;
  }

  let dateStr = dateParam;
  if (!dateStr && dataRows.length > 0) {
    const v = dataRows[0][dateCol];
    if (/^\d{8}$/.test(v)) dateStr = v;
  }
  if (!dateStr) dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const isoDate =
    dateStr.length === 8
      ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
      : dateStr;

  let inserted = 0, skipped = 0, errors = 0;
  const BATCH = 5;

  for (let i = 0; i < dataRows.length; i += BATCH) {
    const batch = dataRows
      .slice(i, i + BATCH)
      .filter(r => r.length > Math.max(stockCol, holdersCol, sharesCol));
    if (!batch.length) continue;

    const params: (string | number)[] = [];
    for (const row of batch) {
      const code = (row[stockCol] || "").replace(/\s/g, "").substring(0, 6);
      if (!code) { skipped++; continue; }
      const rawDate = row[dateCol];
      const rowDate =
        /^\d{8}$/.test(rawDate)
          ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
          : isoDate;
      const bracket = row[bracketCol] || "";
      const holders = parseInt((row[holdersCol] || "0").replace(/,/g, "")) || 0;
      const shares = parseInt((row[sharesCol] || "0").replace(/,/g, "")) || 0;
      const ratio = parseFloat((row[ratioCol] || "0").replace(/,/g, "")) || 0;
      params.push(code, rowDate, bracket, holders, shares, ratio);
    }
    if (!params.length) continue;

    const cnt = params.length / 6;
    const placeholders = Array(cnt).fill("(?,?,?,?,?,?)").join(",");
    const sql = `
      INSERT INTO holder_distribution (stock_code, date, bracket, holders, shares, ratio)
      VALUES ${placeholders}
      ON CONFLICT(stock_code, date, bracket) DO UPDATE SET
        holders = excluded.holders,
        shares = excluded.shares,
        ratio = excluded.ratio
    `;
    try {
      const result = await env.DB.prepare(sql).bind(...params).run();
      if (result.success) inserted += cnt; else errors += cnt;
    } catch { errors += cnt; }
  }

  // Background sync of stock_info if FinMind token available
  if (env.FINMIND_TOKEN) {
    try {
      const newCodes = [...new Set(dataRows.map(r => (r[stockCol] || "").replace(/\s/g, "").substring(0, 6)).filter(Boolean))];
      if (newCodes.length > 0) {
        const existing = await env.DB.prepare(
          `SELECT stock_code FROM stock_info WHERE stock_code IN (${newCodes.map(() => "?").join(",")}) AND industry != ''`
        ).bind(...newCodes).all();
        const existingSet = new Set((existing.results || []).map((r: Record<string, unknown>) => r.stock_code as string));
        const missing = newCodes.filter(c => !existingSet.has(c));
        if (missing.length > 0) {
          fetchFinMindIndustry(env.FINMIND_TOKEN).then(async (infoMap) => {
            const stmts = missing
              .filter(c => infoMap.has(c))
              .map(c => {
                const info = infoMap.get(c)!;
                return env.DB.prepare(`
                  INSERT INTO stock_info (stock_code, stock_name, market, industry)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(stock_code) DO UPDATE SET
                    stock_name = CASE WHEN excluded.stock_name != '' THEN excluded.stock_name ELSE stock_name END,
                    market = CASE WHEN excluded.market != '' THEN excluded.market ELSE market END,
                    industry = CASE WHEN excluded.industry != '' THEN excluded.industry ELSE industry END,
                    updated_at = datetime('now')
                `).bind(c, info.name, info.market, info.industry);
              });
            if (stmts.length) await env.DB.batch(stmts);
          }).catch(console.error);
        }
      }
    } catch (e) {
      console.error("background sync error:", e);
    }
  }

  return jsonResponse({
    success: true,
    source: "tdcc",
    message: `TDCC：匯入 ${inserted} 筆，略過 ${skipped} 筆，失敗 ${errors} 筆`,
    date: isoDate,
    total_rows: dataRows.length,
    inserted, skipped, errors,
  });
}

// ─── Main Router ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/skill-analysis" || path === "/api/skill-analysis/")
      return handleSkillAnalysis(request, env);
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
    if (path === "/api/price" || path === "/api/price/")
      return handlePrice(request, env);
    if (path === "/api/sync-industry" || path === "/api/sync-industry/")
      return handleSyncIndustry(request, env);
    if (path === "/api/industries" || path === "/api/industries/")
      return handleIndustries(request, env);

    const distMatch = path.match(/^\/api\/distribution\/([A-Z0-9]+)$/i);
    if (distMatch) return handleDistribution(request, env, distMatch[1].toUpperCase());

    if (path === "/" || path === "/api") {
      return jsonResponse({
        service: "MSH API",
        version: "1.3.0",
        description: "股權分散表大股東籌碼分析 API",
        endpoints: [
          "GET /api/skill-analysis?market=twse|tpex|all&limit=20",
          "GET /api/big-holder-changes?market=all&limit=5000&sort=total_change&weeks=6&include_price=1&industry=",
          "GET /api/distribution/:stockCode",
          "GET /api/top-changes?type=increase|decrease&market=all&limit=20",
          "GET /api/search?q=keyword",
          "GET /api/stats",
          "GET /api/price?codes=2330,2317&date=2026-06-05",
          "GET /api/industries?market=twse|tpex",
          "POST /api/upload-csv (multipart/form-data: file, source=tdcc, date?)",
          "GET|POST /api/sync-industry (sync stock info from FinMind)",
        ],
      });
    }

    return errorResponse("Not found", 404);
  },
};
