// dashboard.js — local-only viewer. Not deployed.
// Run with: npm run dashboard

import "dotenv/config";
import http from "node:http";
import fs from "node:fs/promises";
import { createZapierSdk } from "@zapier/zapier-sdk";

const PORT = Number(process.env.DASHBOARD_PORT ?? 3737);

const sdk = createZapierSdk({
  credentials: {
    type: "client_credentials",
    clientId: process.env.ZAPIER_CLIENT_ID,
    clientSecret: process.env.ZAPIER_CLIENT_SECRET,
  },
});

function unwrap(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    return String(v.value ?? v.label ?? v.key ?? v.id ?? "");
  }
  return String(v);
}

async function fetchStats() {
  const result = sdk.listTableRecords({
    table: process.env.OPT_OUTS_TABLE_ID,
    keyMode: "names",
    maxItems: 1000,
  });

  const records = [];
  for await (const item of result.items()) records.push(item);

  const counts = { running: 0, completed: 0, escalated: 0, error: 0 };

  // 10-minute buckets, last 2 hours (12 buckets)
  const BUCKET_MS = 10 * 60 * 1000;
  const NUM_BUCKETS = 12;
  const nowBucket = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
  const firstBucket = nowBucket - BUCKET_MS * (NUM_BUCKETS - 1);
  const bucketCounts = new Map();
  for (let i = 0; i < NUM_BUCKETS; i++) {
    bucketCounts.set(firstBucket + i * BUCKET_MS, 0);
  }

  for (const r of records) {
    const s = unwrap(r.data.status).toLowerCase() || "running";
    if (counts[s] !== undefined) counts[s]++;
    const when = r.data.received_at ?? r.data.last_updated ?? r.created_at;
    const t = when ? Date.parse(when) : NaN;
    if (Number.isNaN(t)) continue;
    const b = Math.floor(t / BUCKET_MS) * BUCKET_MS;
    if (bucketCounts.has(b)) bucketCounts.set(b, bucketCounts.get(b) + 1);
  }

  const buckets = Array.from(bucketCounts.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, count]) => ({ ts, count }));

  const lastTenMin = buckets[buckets.length - 1]?.count ?? 0;

  const rows = records
    .map((r) => ({
      id: r.id,
      received_at: r.data.received_at ?? r.data.last_updated ?? r.created_at ?? null,
      from: r.data.from_address ?? "",
      classification: unwrap(r.data.classification),
      step: unwrap(r.data.step),
      status: unwrap(r.data.status).toLowerCase(),
    }))
    .sort((a, b) => {
      const ta = Date.parse(a.received_at ?? "") || 0;
      const tb = Date.parse(b.received_at ?? "") || 0;
      return tb - ta;
    })
    .slice(0, 50);

  let heartbeat = null;
  try {
    heartbeat = JSON.parse(await fs.readFile(".state.json", "utf8"));
  } catch {}

  return {
    total: records.length,
    counts,
    buckets,
    bucket_minutes: 10,
    last_ten_min: lastTenMin,
    rows,
    heartbeat,
  };
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>opt-out handler — local dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0f172a; color: #f1f5f9;
  }
  header { padding: 24px 32px; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: baseline; }
  h1 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: 0.02em; }
  .sub { color: #64748b; font-size: 12px; }
  main { padding: 32px; max-width: 1100px; margin: 0 auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
  .card {
    background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 18px 20px;
  }
  .label { color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
  .stat { font-size: 32px; font-weight: 600; margin-top: 6px; }
  .stat.green { color: #10b981; }
  .stat.amber { color: #f59e0b; }
  .stat.red { color: #ef4444; }
  .stat.blue { color: #60a5fa; }
  .chart-wrap { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 20px; margin-top: 24px; }
  footer { padding: 16px 32px; color: #64748b; font-size: 12px; text-align: center; }
  .pulse { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981; margin-right: 6px; animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .stale .pulse { background: #f59e0b; animation: none; }
  .err   .pulse { background: #ef4444; animation: none; }

  .table-wrap { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 20px; margin-top: 24px; }
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 16px; }
  .pill {
    background: #0f172a; border: 1px solid #334155; color: #cbd5e1;
    padding: 6px 12px; border-radius: 999px; font-size: 12px; cursor: pointer;
    user-select: none; transition: background 0.1s, border-color 0.1s;
  }
  .pill:hover { border-color: #64748b; }
  .pill.active { background: #334155; border-color: #60a5fa; color: #f1f5f9; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #94a3b8; font-weight: 500; padding: 8px 10px; border-bottom: 1px solid #334155; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
  td { padding: 10px; border-bottom: 1px solid #1e293b; color: #e2e8f0; }
  tr:last-child td { border-bottom: none; }
  .from-cell { color: #cbd5e1; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px;
    background: #334155; color: #cbd5e1;
  }
  .badge.completed { background: rgba(16,185,129,0.15); color: #10b981; }
  .badge.escalated { background: rgba(245,158,11,0.15); color: #f59e0b; }
  .badge.error     { background: rgba(239,68,68,0.15);  color: #ef4444; }
  .badge.running   { background: rgba(96,165,250,0.15); color: #60a5fa; }
  .empty { padding: 24px; text-align: center; color: #64748b; }
</style>
</head>
<body>
<header>
  <h1>opt-out handler <span class="sub">— local dashboard</span></h1>
  <div id="heartbeat" class="sub"><span class="pulse"></span><span id="hb-text">loading…</span></div>
</header>
<main>
  <div class="grid">
    <div class="card"><div class="label">Total</div><div class="stat blue"  id="s-total">—</div></div>
    <div class="card"><div class="label">Completed</div><div class="stat green" id="s-completed">—</div></div>
    <div class="card"><div class="label">Escalated</div><div class="stat amber" id="s-escalated">—</div></div>
    <div class="card"><div class="label">Errored</div><div class="stat red"   id="s-error">—</div></div>
    <div class="card"><div class="label">Last 10m</div><div class="stat" id="s-recent">—</div></div>
  </div>
  <div class="chart-wrap">
    <div class="label">Emails per 10 min · last 2 hours</div>
    <canvas id="chart" height="90"></canvas>
  </div>
  <div class="table-wrap">
    <div class="label">Recent opt-outs</div>
    <div class="toolbar" id="filters">
      <span class="pill active" data-filter="all">All</span>
      <span class="pill" data-filter="running">Running</span>
      <span class="pill" data-filter="completed">Completed</span>
      <span class="pill" data-filter="escalated">Escalated</span>
      <span class="pill" data-filter="error">Errored</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>From</th>
          <th>Class</th>
          <th>Step</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
</main>
<footer>auto-refresh every 5s · reads directly from your opt_outs Zapier Table</footer>
<script>
  const $ = (id) => document.getElementById(id);
  let chart;
  let activeFilter = "all";
  let lastRows = [];

  document.getElementById("filters").addEventListener("click", (e) => {
    const pill = e.target.closest(".pill");
    if (!pill) return;
    document.querySelectorAll("#filters .pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    activeFilter = pill.dataset.filter;
    renderRows();
  });

  function fmtWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    const ss = d.getSeconds().toString().padStart(2, "0");
    return sameDay ? hh + ":" + mm + ":" + ss : d.toISOString().slice(5, 16).replace("T", " ");
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  }

  function renderRows() {
    const tbody = $("rows");
    const filtered = activeFilter === "all"
      ? lastRows
      : lastRows.filter(r => r.status === activeFilter);
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">no rows</td></tr>';
      return;
    }
    tbody.innerHTML = filtered.map(r =>
      "<tr>" +
        "<td>" + esc(fmtWhen(r.received_at)) + "</td>" +
        '<td class="from-cell" title="' + esc(r.from) + '">' + esc(r.from || "—") + "</td>" +
        "<td>" + esc(r.classification || "—") + "</td>" +
        "<td>" + esc(r.step || "—") + "</td>" +
        '<td><span class="badge ' + esc(r.status) + '">' + esc(r.status || "—") + "</span></td>" +
      "</tr>"
    ).join("");
  }

  function fmtAge(iso) {
    if (!iso) return "no ticks yet";
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return Math.floor(diff) + "s ago";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    return Math.floor(diff / 3600) + "h ago";
  }

  async function refresh() {
    try {
      const res = await fetch("/api/stats");
      const s = await res.json();
      $("s-total").textContent = s.total;
      $("s-completed").textContent = s.counts.completed;
      $("s-escalated").textContent = s.counts.escalated;
      $("s-error").textContent = s.counts.error;
      $("s-recent").textContent = s.last_ten_min;

      const fmtHHMM = (ts) => {
        const d = new Date(ts);
        return d.getHours().toString().padStart(2, "0") + ":" +
               d.getMinutes().toString().padStart(2, "0");
      };
      lastRows = s.rows ?? [];
      renderRows();

      const labels = s.buckets.map(b => fmtHHMM(b.ts));
      const data = s.buckets.map(b => b.count);
      if (!chart) {
        chart = new Chart($("chart"), {
          type: "bar",
          data: { labels, datasets: [{
            label: "emails", data,
            backgroundColor: "#60a5fa", borderRadius: 6,
          }]},
          options: {
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } },
              y: { ticks: { color: "#94a3b8", precision: 0 }, grid: { color: "#1e293b" }, beginAtZero: true },
            },
            responsive: true,
          },
        });
      } else {
        chart.data.labels = labels;
        chart.data.datasets[0].data = data;
        chart.update();
      }

      const hb = s.heartbeat;
      const wrap = $("heartbeat");
      wrap.classList.remove("stale", "err");
      if (!hb) {
        $("hb-text").textContent = "no ticks yet";
        wrap.classList.add("stale");
      } else if (hb.error) {
        $("hb-text").textContent = "last poll errored · " + fmtAge(hb.last_tick);
        wrap.classList.add("err");
      } else {
        const age = (Date.now() - new Date(hb.last_tick).getTime()) / 1000;
        $("hb-text").textContent = "last checked " + fmtAge(hb.last_tick) + " · saw " + hb.emails_seen;
        if (age > 180) wrap.classList.add("stale");
      }
    } catch (e) {
      $("hb-text").textContent = "dashboard fetch failed: " + e.message;
      $("heartbeat").classList.add("err");
    }
  }
  refresh();
  setInterval(refresh, 5000);
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(HTML);
    }
    if (req.url === "/api/stats") {
      const stats = await fetchStats();
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(stats));
    }
    res.writeHead(404).end("not found");
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});

server.listen(PORT, () => {
  console.log(`dashboard → http://localhost:${PORT}`);
});
