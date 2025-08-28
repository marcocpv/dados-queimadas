// scripts/baixar_inpe.js (Node 18+, CommonJS)
const fs = require('fs');
const path = require('path');

const INPE_BASE = 'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/10min/';

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

async function main() {
  let now = roundTo10MinUTC(new Date());
  let csvRaw = null;
  let usedName = null;

  for (let back = 0; back <= 60; back += 10) {
    const t = new Date(now.getTime());
    t.setUTCMinutes(t.getUTCMinutes() - back);
    const fname = formatNameUTC(t);
    const url = INPE_BASE + fname;
    try {
      console.log('Tentando:', url);
      csvRaw = await tryFetch(url);
      usedName = fname;
      break;
    } catch (e) {
      console.log('Falhou:', e.message);
    }
  }

  if (!csvRaw) {
    console.error('Nenhum CSV disponível nos últimos 60 min.');
    process.exit(0);
  }

  const lines = String(csvRaw).split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length <= 1) {
    console.error('CSV sem dados úteis.');
    process.exit(0);
  }

  const header = lines[0].split(',').map(s => s.trim());
  const normHeader = header.map(normalizeHeader);

  const idxLat  = normHeader.findIndex(h => ['lat','latitude'].includes(h));
  const idxLon  = normHeader.findIndex(h => ['lon','longitude','long'].includes(h));
  const idxSat  = normHeader.findIndex(h => ['satelite','satellite','satelite'].includes(h));
  const idxData = normHeader.findIndex(h =>
    ['data','datahora','horagmt','data_hora_gmt','datetime','date','hora','datagmt'].includes(h)
  );

  if (idxLat < 0 || idxLon < 0 || idxSat < 0 || idxData < 0) {
    console.error('Não encontrei colunas esperadas (lat, lon, satelite, data).');
    process.exit(0);
  }

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

  fs.mkdirSync(path.join(process.cwd(), 'queimada'), { recursive: true });
  const dest = path.join(process.cwd(), 'queimada', 'queimadas.csv');
  const headerOut = 'lat,lon,satelite,data\n';
  const body = out.map(r => `${r.lat.toFixed(6)},${r.lon.toFixed(6)},${r.satelite},${r.data}`).join('\n');
  fs.writeFileSync(dest, headerOut + body, 'utf8');

  console.log(`Gerado: ${dest} (${out.length} linhas) a partir de ${usedName}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
