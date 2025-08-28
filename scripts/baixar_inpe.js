// scripts/baixar_inpe.js (Node 18+, CommonJS)
const fs = require('fs');
const path = require('path');

const INPE_BASE = 'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/10min/';

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function roundTo10MinUTC(d) {
  const t = new Date(d.getTime());
  t.setUTCMinutes(Math.floor(t.getUTCMinutes() / 10) * 10, 0, 0);
  return t;
}
function formatNameUTC(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const MM = String(d.getUTCMinutes()).padStart(2, '0');
  return `focos_10min_${yyyy}${mm}${dd}_${HH}${MM}.csv`;
}
function yyyymmdd(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}
function hhmm(d) {
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const MM = String(d.getUTCMinutes()).padStart(2, '0');
  return `${HH}${MM}`;
}
function slotPath(d) {
  return path.join(process.cwd(), 'queimada', '10min', yyyymmdd(d), `${hhmm(d)}.csv`);
}
function normalizeHeader(s) {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}
async function tryFetch(url, ms = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  const resp = await fetch(url, { signal: controller.signal });
  clearTimeout(id);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.text();
}
function parseGoes(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length <= 1) return [];
  const header = lines[0].split(',').map(s => s.trim());
  const norm = header.map(normalizeHeader);
  const idxLat  = norm.findIndex(h => ['lat','latitude'].includes(h));
  const idxLon  = norm.findIndex(h => ['lon','longitude','long'].includes(h));
  const idxSat  = norm.findIndex(h => ['satelite','satellite','satelite'].includes(h));
  const idxData = norm.findIndex(h => ['data','datahora','horagmt','data_hora_gmt','datetime','date','hora','datagmt'].includes(h));
  if (idxLat < 0 || idxLon < 0 || idxSat < 0 || idxData < 0) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const sat = (cols[idxSat] || '').trim().toUpperCase();
    if (sat !== 'GOES-19') continue;
    const lat = Number((cols[idxLat] || '').trim());
    const lon = Number((cols[idxLon] || '').trim());
    const data = (cols[idxData] || '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !data) continue;
    out.push({ lat, lon, satelite: 'GOES-19', data });
  }
  return out;
}
function writeCsv(dest, rows) {
  ensureDir(path.dirname(dest));
  const header = 'lat,lon,satelite,data\n';
  const body = rows.map(r => `${r.lat.toFixed(6)},${r.lon.toFixed(6)},${r.satelite},${r.data}`).join('\n');
  fs.writeFileSync(dest, header + body, 'utf8');
}
function dedupeRows(rows) {
  const set = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${r.lat.toFixed(6)},${r.lon.toFixed(6)},${r.data}`;
    if (set.has(key)) continue;
    set.add(key);
    out.push(r);
  }
  return out;
}

async function fetchSlot(d) {
  const fname = formatNameUTC(d);
  const url = INPE_BASE + fname;
  try {
    const csv = await tryFetch(url);
    return parseGoes(csv);
  } catch {
    return [];
  }
}

async function buildAggregate(hours, base) {
  const all = [];
  for (let m = 0; m < hours * 60; m += 10) {
    const t = new Date(base.getTime());
    t.setUTCMinutes(t.getUTCMinutes() - m);
    const p = slotPath(t);
    let rows = [];
    if (fs.existsSync(p)) {
      try {
        rows = parseGoes(fs.readFileSync(p, 'utf8'));
      } catch {}
    } else {
      rows = await fetchSlot(t);
      if (rows.length > 0) {
        writeCsv(p, rows); // salva para histórico
      }
    }
    if (rows.length > 0) all.push(...rows);
  }
  return dedupeRows(all);
}

async function main() {
  // 1) Baixa/descobre o último disponível (até 60 min para trás)
  const now = roundTo10MinUTC(new Date());
  let used = null;
  let rows = [];
  for (let back = 0; back <= 60; back += 10) {
    const t = new Date(now.getTime());
    t.setUTCMinutes(t.getUTCMinutes() - back);
    const fetched = await fetchSlot(t);
    if (fetched.length > 0) {
      rows = fetched;
      used = t;
      break;
    }
  }
  if (!used) {
    console.log('Nenhum CSV disponível nos últimos 60 min.');
    return;
  }

  // 2) Publica o último e salva o slot 10min
  writeCsv(path.join(process.cwd(), 'queimada', 'queimadas.csv'), rows);
  writeCsv(slotPath(used), rows);

  // 3) Gera agregados 5h e 10h lendo do histórico 10min (e buscando faltantes)
  const agg5 = await buildAggregate(5, now);
  writeCsv(path.join(process.cwd(), 'queimada', 'ultimas_5h.csv'), agg5);

  const agg10 = await buildAggregate(10, now);
  writeCsv(path.join(process.cwd(), 'queimada', 'ultimas_10h.csv'), agg10);

  console.log(`Último: ${rows.length} | 5h: ${agg5.length} | 10h: ${agg10.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
