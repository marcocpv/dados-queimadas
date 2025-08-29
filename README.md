## Integração de Queimadas (GOES-19) via GitHub Actions

Este documento explica como os arquivos `queimadas.yml` e `baixar_inpe.js` trabalham juntos para baixar os focos do INPE (GOES-19), versionar o histórico e publicar três CSVs consumidos pelo PWA:

- `queimada/queimadas.csv` → último slot de 10 min
- `queimada/ultimas_5h.csv` → agregado das últimas 5 horas
- `queimada/ultimas_10h.csv` → agregado das últimas 10 horas

O PWA lê estes arquivos diretamente do repositório público (GitHub Raw).

---

### Visão geral

1) Um workflow do GitHub Actions (`queimadas.yml`) roda em agenda (cron) e dispara o script Node.
2) O script `baixar_inpe.js` baixa o CSV do INPE, filtra apenas GOES‑19, salva o slot em `queimada/10min/YYYYMMDD/HHMM.csv` e atualiza os agregados (5h/10h).
3) Se houve mudanças, o workflow commita e envia (push) os três CSVs e os slots 10min.

---

### Workflow `queimadas.yml`

Pontos importantes do workflow:

- `schedule` (cron): está configurado para rodar em `4,14,24,34,44,54 * * * *` (UTC). Isso significa 4 minutos após cada janela de 10 min. O script ainda aguarda 90s antes de baixar para evitar pegar janelas incompletas.
- `concurrency`: garante que um job cancele o anterior se ainda estiver em execução.
- `setup-node`: usa Node 18.
- Execução: roda o script com Node e, se houve mudança de arquivos, faz commit e push.

Observação sobre o caminho do script: no seu repositório, o arquivo está na raiz como `baixar_inpe.js`. No YAML de exemplo, o comando está `node scripts/baixar_inpe.js`.

- Se você mantiver o script na raiz, altere para:
```yaml
run: |
  node baixar_inpe.js
```
- Se preferir a pasta `scripts/`, mova o arquivo para `scripts/baixar_inpe.js` e mantenha o YAML atual.

Exemplo completo de etapa (com script na raiz):
```yaml
- name: Baixar INPE e gerar CSVs
  run: |
    node baixar_inpe.js
```

---

### Script `baixar_inpe.js` (Node 18+, CommonJS)

Responsabilidades principais:

- Base INPE: `https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/10min/`
- Alinhamento de janelas: `nearestPastWindowUTC(d, 6)` ancora em minutos 06/16/26/36/46/56 (fallback âncora 00) para sincronizar com a publicação do INPE.
- Busca resiliente: procura o último CSV disponível voltando até ~80 minutos.
- Parse e filtro: lê CSV, normaliza cabeçalhos, e mantém apenas satélite `GOES-19`.
- Deduplicação: remove linhas duplicadas por `(lat,lon,data)`.
- Persistência:
  - `queimada/queimadas.csv` (último slot 10min)
  - `queimada/10min/YYYYMMDD/HHMM.csv` (histórico de slots)
  - agregados `ultimas_5h.csv` e `ultimas_10h.csv`, montados a partir do histórico 10min (buscando faltantes se preciso)

Arquitetura de saída:
```
queimada/
  10min/
    20250828/
      2310.csv
      2320.csv
      ...
  queimadas.csv
  ultimas_5h.csv
  ultimas_10h.csv
```

Formato CSV (cabeçalho):
```
lat,lon,satelite,data
-12.345678,-45.678901,GOES-19,2025-08-28 23:10:00
```

---

### Execução local (para testes)

Requisitos: Node 18+

```bash
node baixar_inpe.js
```

Saída esperada no terminal (exemplo):
```
Último: 132 | 5h: 892 | 10h: 1634
```

Arquivos gerados dentro da pasta `queimada/` conforme descrito acima.

---

### Boas práticas e ajustes

- Agenda (cron): manter leve defasagem após a janela (4–6 minutos) e aguardar ~90s antes do fetch reduz falsos vazios.
- Timeout: o fetch usa `AbortController` com timeout; ajuste se necessário.
- Histórico: os agregados 5h/10h são lidos do histórico 10min; manter o diretório no repositório melhora a robustez.
- Caminhos: alinhar o caminho do script no workflow com a localização do arquivo no repositório (raiz vs `scripts/`).

---

### Integração com o PWA

O PWA consome estes CSVs diretamente do GitHub Raw. Para cada foco, o app:

- Mostra 🔥 (até 300 pontos) ou polígono leve (acima de 300) para performance.
- Integra com o motor de buffers (10/20/30 km), preenche o banner de “Focos de Queimadas” e toca som específico.

---

### FAQ rápido

- “Por que ancorar em 06/16/26/…?”
  - Para alinhar ao compasso de publicação do INPE e evitar pegar janelas incompletas.
- “E se não houver CSV da última janela?”
  - O script volta até ~80 min para pegar o último disponível.
- “Dá para mudar o período dos agregados?”
  - Sim. Ajuste as chamadas a `buildAggregate(5, ...)`/`buildAggregate(10, ...)` no script.

---

Qualquer dúvida, abra uma issue ou comente no commit do workflow/script.


