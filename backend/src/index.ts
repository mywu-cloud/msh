/**
 * MSH - 股權分散表大股東籌碼分析 API
 * Cloudflare Workers Backend
 */

export interface Env {
  DB: D1Database;
  CACHE?: KVNamespace
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

// ─── Route Handlers ─────────────────────────────────────────────────────────

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
 * 大股東持有比率週增減排行（類神秘金字塔格式）
 */
async function handleBigHolderChanges(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const market = url.searchParams.get("market") || "all";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 5000);
  const sort = url.searchParams.get("sort") || "total_change";
  const weeks = Math.min(parseInt(url.searchParams.get("weeks") || "6"), 12);

  const cacheKey = `bigholderchanges:${market}:${limit}:${sort}:${weeks}`;
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
      marketFilter = `AND si.market = 'twse'`;
    } else if (market === "tpex") {
      marketFilter = `AND si.market = 'tpex'`;
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
      WHERE hd.date IN (${datesList})
      ${marketFilter}
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
      const row = rawRow as { stock_code: string; stock_name: string; market: string; industry: string; date: string; big_holder_ratio: number };
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
      stock_code: string;
      stock_name: string;
      market: string;
      industry: string;
      week_changes: Record<string, number>;
      total_change: number;
      latest_change: number;
      latest_ratio: number;
      week_dates: string[];
    }> = [];

    for (const [, stock] of stockMap) {
      if (!stock.ratioByDate[latestDate]) continue;
      const weekChanges: Record<string, number> = {};
      let totalChange = 0;
      for (let i = 0; i < weekDates.length; i++) {
        const d = weekDates[i];
        const curr = stock.ratioByDate[d] ?? null;
        const prev = i === 0 ? (stock.ratioByDate[prevDate] ?? null) : (stock.ratioByDate[weekDates[i - 1]] ?? null);
        if (curr !== null && prev !== null) {
          const change = Math.round((curr - prev) * 100) / 100;
          weekChanges[d] = change;
          totalChange += change;
        } else {
          weekChanges[d] = 0;
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
    const responseData = {
      meta: {
        market, limit, sort,
        weeks: weekDates.length,
        week_dates: weekDates,
        count: topResult.length,
        generated_at: new Date().toISOString(),
      },
      data: topResult,
    };
    const responseText = JSON.stringify(responseData);
    if (env.CACHE) await env.CACHE.put(cacheKey, responseText, { expirationTtl: 3600 });
    return new Response(responseText, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("handleBigHolderChanges error:", err);
    return errorResponse("Database query failed", 500);
  }
}

/**
 * GET /api/distribution/:stockCode
 */
async function handleDistribution(request: Request, env: Env, stockCode: string): Promise<Response> {
  if (!stockCode || !/^\d{4}[A-Z]?$/.test(stockCode)) return errorResponse("Invalid stock code");

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
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);

  const cacheKey = `topchanges:${type}:${limit}`;
  const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
  if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, "X-Cache": "HIT" } });

  try {
    const orderDir = type === "increase" ? "DESC" : "ASC";
    const sql = `
      SELECT sa.stock_code, si.stock_name, si.market,
             sa.big_holder_trend, sa.latest_week_change,
             sa.skill_score, sa.alert, sa.analysis_date
      FROM skill_analysis sa
      LEFT JOIN stock_info si ON sa.stock_code = si.stock_code
      WHERE sa.analysis_date = (SELECT MAX(analysis_date) FROM skill_analysis)
      ORDER BY sa.latest_week_change ${orderDir}
      LIMIT ${limit}
    `;
    const result = await env.DB.prepare(sql).all();
    const responseData = {
      meta: { type, limit, count: result.results?.length || 0 },
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

/**
 * POST /api/upload-csv
 * 手動上傳 CSV 並匯入 D1
 *
 * 支援兩種來源格式：
 * 1. TDCC 格式 (tdcc.com.tw)      → 寫入 holder_distribution
 *    欄位: 日期(YYYYMMDD), 證券代號, 持股分級, 人數, 股數, 比例
 * 2. Norway 格式 (norway.twsthr.info) → 寫入 skill_analysis
 *    欄位: #, 股票代號/名稱, 類別, [週YYYYMMDD...], 總增減, 上週持有%
 *
 * Request: multipart/form-data
 *   file:   CSV 檔案（必填）
 *   source: "tdcc" | "norway"（選填，預設自動偵測）
 *   date:   YYYYMMDD（選填，TDCC 若 CSV 無日期欄時使用）
 */
async function handleUploadCsv(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  const contentType = request.headers.get("content-type") || "";
  if (
    !contentType.includes("multipart/form-data") &&
    !contentType.includes("text/csv") &&
    !contentType.includes("application/octet-stream")
  ) {
    return jsonResponse({ error: "請以 multipart/form-data 上傳 CSV，欄位名稱為 'file'" }, 400);
  }

  let csvText = "", dateParam = "", sourceHint = "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return jsonResponse({ error: "找不到 'file' 欄位，請上傳 CSV 檔案" }, 400);
    }
    csvText = await (file as File).text();
    dateParam  = (formData.get("date")   as string) || "";
    sourceHint = ((formData.get("source") as string) || "").toLowerCase();
  } else {
    csvText = await request.text();
    const url = new URL(request.url);
    dateParam  = url.searchParams.get("date")   || "";
    sourceHint = (url.searchParams.get("source") || "").toLowerCase();
  }

  if (!csvText.trim()) return jsonResponse({ error: "CSV 內容為空" }, 400);

  const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim());
  const firstCells = lines[0].split(",").map(c => c.trim().replace(/^"|"$/g, ""));

  // 自動偵測格式：Norway 的第1欄是 "#"，或第2欄含 "/"，或第3欄含 "類別"
  let source = sourceHint;
  if (!source) {
    if (
      firstCells[0] === "#" ||
      (firstCells[1] || "").includes("/") ||
      (firstCells[2] || "").includes("類別")
    ) {
      source = "norway";
    } else {
      source = "tdcc";
    }
  }

  if (source === "norway") return handleNorwayCsv(lines, env);
  return handleTdccCsv(lines, firstCells, dateParam, env);
}

// ── TDCC 格式：寫入 holder_distribution ─────────────────────────────────────
async function handleTdccCsv(
  lines: string[],
  firstCells: string[],
  dateParam: string,
  env: Env
): Promise<Response> {
  const rows = lines.map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));

  // 偵測是否有 header 行
  const isHeader =
    !/^\d{8}$/.test(firstCells[0]) && !/^\d{4,6}$/.test(firstCells[0]);
  const dataRows = isHeader ? rows.slice(1) : rows;

  // 欄位對應（預設 opendata 格式）
  let dateCol = 0, stockCol = 1, bracketCol = 2, holdersCol = 3, sharesCol = 4, ratioCol = 5;
  if (isHeader) {
    const header = rows[0].map(h => h.toLowerCase());
    const findCol = (names: string[]) =>
      names.reduce<number>((f, n) => f >= 0 ? f : header.findIndex(h => h.includes(n)), -1);
    const d  = findCol(["date", "日期", "scadate"]);
    const s  = findCol(["stock_code", "證券代號", "code"]);
    const b  = findCol(["bracket", "持股分級", "持股"]);
    const h  = findCol(["holders", "人數"]);
    const sh = findCol(["shares", "股數"]);
    const r  = findCol(["ratio", "比例", "佔"]);
    if (d  >= 0) dateCol    = d;
    if (s  >= 0) stockCol   = s;
    if (b  >= 0) bracketCol = b;
    if (h  >= 0) holdersCol = h;
    if (sh >= 0) sharesCol  = sh;
    if (r  >= 0) ratioCol   = r;
  }

  // 從資料推斷日期
  let dateStr = dateParam;
  if (!dateStr && dataRows.length > 0) {
    const v = dataRows[0][dateCol];
    if (/^\d{8}$/.test(v)) dateStr = v;
  }
  if (!dateStr) dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const isoDate =
    dateStr.length === 8
      ? `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`
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
          ? `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`
          : isoDate;
      const bracket = row[bracketCol] || "";
      const holders = parseInt((row[holdersCol] || "0").replace(/,/g, "")) || 0;
      const shares  = parseInt((row[sharesCol]  || "0").replace(/,/g, "")) || 0;
      const ratio   = parseFloat((row[ratioCol] || "0").replace(/,/g, "")) || 0;
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
        shares  = excluded.shares,
        ratio   = excluded.ratio
    `;
    try {
      const result = await env.DB.prepare(sql).bind(...params).run();
      if (result.success) inserted += cnt; else errors += cnt;
    } catch { errors += cnt; }
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

// ── Norway 格式：寫入 skill_analysis ────────────────────────────────────────
async function handleNorwayCsv(lines: string[], env: Env): Promise<Response> {
  const rows = lines.map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
  const header   = rows[0];
  const dataRows = rows.slice(1).filter(r => r.length >= 4 && r[0] !== "");

  // 找日期欄（YYYYMMDD）
  const weekCols: Array<{ col: number; isoDate: string }> = [];
  for (let c = 0; c < header.length; c++) {
    const h = header[c].replace(/\s/g, "");
    if (/^\d{8}$/.test(h)) {
      weekCols.push({ col: c, isoDate: `${h.slice(0,4)}-${h.slice(4,6)}-${h.slice(6,8)}` });
    }
  }
  if (!weekCols.length) {
    return jsonResponse({ error: "Norway CSV 中找不到日期欄（格式應為 YYYYMMDD）" }, 400);
  }

  const analysisDate = weekCols[weekCols.length - 1].isoDate;
  const trendColIdx  = header.findIndex(h => h.includes("總增減") || h.toLowerCase().includes("total"));
  const ratioColIdx  = header.findIndex(h => h.includes("持有")   || h.toLowerCase().includes("ratio"));

  let inserted = 0, skipped = 0, errors = 0;

  for (const row of dataRows) {
    const rawStock = (row[1] || "").trim();
    if (!rawStock) { skipped++; continue; }

    let stockCode = "", stockName = "";
    const slashIdx = rawStock.indexOf("/");
    if (slashIdx > 0) {
      stockCode = rawStock.slice(0, slashIdx).trim();
      stockName = rawStock.slice(slashIdx + 1).trim();
    } else {
      const m = rawStock.match(/^(\d{4,6}[A-Z]?)(.*)/);
      if (m) { stockCode = m[1]; stockName = m[2].trim(); }
      else stockCode = rawStock;
    }
    if (!stockCode) { skipped++; continue; }

    const latestChange =
      parseFloat((row[weekCols[weekCols.length - 1].col] || "0").replace(/,/g, "")) || 0;
    const bigHolderTrend =
      trendColIdx >= 0
        ? parseFloat((row[trendColIdx] || "0").replace(/,/g, "")) || 0
        : weekCols.reduce((s, wc) => s + (parseFloat((row[wc.col] || "0").replace(/,/g, "")) || 0), 0);
    const bigHolderRatio =
      ratioColIdx >= 0
        ? parseFloat((row[ratioColIdx] || "0").replace(/,/g, "")) || 0
        : 0;

    const skillScore = Math.round((bigHolderTrend * 0.6 + latestChange * 0.4) * 100) / 100;
    const alert      = latestChange > 2 ? 1 : 0;

    // Upsert stock_info
    if (stockName) {
      try {
        await env.DB.prepare(`
          INSERT INTO stock_info (stock_code, stock_name)
          VALUES (?, ?)
          ON CONFLICT(stock_code) DO UPDATE SET
            stock_name = CASE WHEN excluded.stock_name != '' THEN excluded.stock_name ELSE stock_name END
        `).bind(stockCode, stockName).run();
      } catch { /* ignore */ }
    }

    // Upsert skill_analysis
    try {
      const result = await env.DB.prepare(`
        INSERT INTO skill_analysis
          (stock_code, analysis_date, skill_score, big_holder_ratio,
           big_holder_trend, retail_trend, holder_change, latest_week_change, alert)
        VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
        ON CONFLICT(stock_code, analysis_date) DO UPDATE SET
          skill_score        = excluded.skill_score,
          big_holder_ratio   = excluded.big_holder_ratio,
          big_holder_trend   = excluded.big_holder_trend,
          latest_week_change = excluded.latest_week_change,
          alert              = excluded.alert
      `).bind(stockCode, analysisDate, skillScore, bigHolderRatio, bigHolderTrend, latestChange, alert).run();
      if (result.success) inserted++; else errors++;
    } catch { errors++; }
  }

  return jsonResponse({
    success: true,
    source: "norway",
    message: `Norway：匯入 ${inserted} 筆至 skill_analysis，略過 ${skipped} 筆，失敗 ${errors} 筆`,
    analysis_date: analysisDate,
    weeks_found: weekCols.map(w => w.isoDate),
    total_rows: dataRows.length,
    inserted, skipped, errors,
  });
}

// ─── Main Router ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    const url  = new URL(request.url);
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

    const distMatch = path.match(/^\/api\/distribution\/([A-Z0-9]+)$/i);
    if (distMatch) return handleDistribution(request, env, distMatch[1].toUpperCase());

    if (path === "/" || path === "/api") {
      return jsonResponse({
        service: "MSH API",
        version: "1.1.0",
        description: "股權分散表大股東籌碼分析 API",
        endpoints: [
          "GET  /api/skill-analysis?market=twse|tpex|all&limit=20",
          "GET  /api/distribution/:stockCode",
          "GET  /api/top-changes?type=increase|decrease&limit=20",
          "GET  /api/search?q=keyword",
          "GET  /api/stats",
          "POST /api/upload-csv  (multipart/form-data: file, source=[tdcc|norway], date?)",
        ],
      });
    }

    return errorResponse("Not found", 404);
  },
};
