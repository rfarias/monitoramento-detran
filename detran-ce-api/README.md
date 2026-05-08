# Detran-CE API

API local em Node.js para ler uma planilha de veiculos, consultar informacoes no portal do Detran-CE com Playwright, salvar o historico das consultas e enviar uma notificacao por e-mail quando encontrar pendencias.

## Fluxo Do Monitoramento

O fluxo principal fica em `src/monitor.js`:

1. Le a planilha definida em `PLANILHA_PATH`.
2. Consulta cada veiculo no portal do Detran-CE usando `src/detranCeBot.js`.
3. Salva todas as consultas no historico local.
4. Separa os veiculos com `status: "com_pendencias"`.
5. Salva os registros de pendencias em `data/pendencias-log.json`.
6. Gera uma mensagem resumida em `data/ultima-mensagem.txt`.
7. Envia a mensagem por e-mail SMTP e/ou webhook, conforme configuracao do `.env`.

Exemplo de mensagem enviada:

```text
Monitoramento Detran-CE - 08/05/2026, 09:30

2 veiculos com pendencias:

- HUQ8083: debito de licenciamento.
- PMY7F63: 6 multas.
```

## Requisitos

- Node.js 18 ou superior
- Windows, macOS ou Linux
- Acesso ao portal do Detran-CE pelo navegador

## Instalacao

```bash
cd detran-ce-api
npm install
npm run install-browsers
```

## Configuracao

Edite o arquivo `.env`:

```env
PORT=3000
API_KEY=troque_essa_chave
PLANILHA_PATH=./data/veiculos.xlsx
HEADLESS=false
DETRAN_BASE_URL=https://sistemas.detran.ce.gov.br/central
DETRAN_CONSULTA_URL=https://sistemas.detran.ce.gov.br/central
DETRAN_ABA_TEXTO=Veiculos
DETRAN_SERVICO_TEXTO=Taxas / Multas
DELAY_ENTRE_CONSULTAS_MS=5000
PLAYWRIGHT_TIMEOUT_MS=45000
```

Use `HEADLESS=false` enquanto ajusta os seletores do portal. Depois que a consulta estiver estavel, altere para `HEADLESS=true`.

`DETRAN_CONSULTA_URL` deve apontar para a Central de Veiculos ou para uma URL direta da consulta, quando existir. No portal atual, a tela abre como modal/overlay e a URL pode continuar igual:

```env
DETRAN_CONSULTA_URL=https://sistemas.detran.ce.gov.br/central
```

No fluxo atual da Central, a automacao entra na aba configurada em `DETRAN_ABA_TEXTO` e depois clica no item configurado em `DETRAN_SERVICO_TEXTO`.

```env
DETRAN_ABA_TEXTO=Veiculos
DETRAN_SERVICO_TEXTO=Taxas / Multas
```

## Planilha

A planilha deve ter apenas as colunas `placa` e `renavam`.

Exemplo CSV:

```csv
placa,renavam
ABC1D23,12345678901
XYZ9A88,98765432100
```

O projeto aceita `.xlsx` e `.csv`. A pasta `data/` nao e enviada para o repositorio; cada instalacao deve criar sua propria pasta e preencher a planilha com os veiculos desejados.

Por padrao, o `.env.example` usa:

```env
PLANILHA_PATH=./data/veiculos.xlsx
```

Se preferir CSV, crie o arquivo localmente e altere no `.env`:

```env
PLANILHA_PATH=./data/veiculos.csv
```

## Iniciar API

```bash
npm run dev
```

ou:

```bash
npm start
```

A API ficara em:

```text
http://localhost:3000
```

## Usar Pelo Navegador

Abra no navegador:

```text
http://localhost:3000
```

Na tela, informe a chave configurada no `.env`, envie uma planilha `.xlsx` ou `.csv` e clique em `Consultar todos`.

O upload salva a planilha em `data/uploads/` e passa a usar essa planilha nas proximas chamadas de `/veiculos` e `/consultar-todos`.

## Endpoints

`GET /health` nao exige autenticacao:

```bash
curl http://localhost:3000/health
```

Todos os demais endpoints exigem o header `x-api-key`.

Listar veiculos da planilha:

```bash
curl -H "x-api-key: troque_essa_chave" http://localhost:3000/veiculos
```

Consultar um veiculo:

```bash
curl -X POST http://localhost:3000/consultar ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: troque_essa_chave" ^
  -d "{\"placa\":\"ABC1D23\",\"renavam\":\"12345678901\"}"
```

Consultar todos os veiculos da planilha, em fila:

```bash
curl -X POST http://localhost:3000/consultar-todos ^
  -H "x-api-key: troque_essa_chave"
```

O resultado desse endpoint ja permite filtrar os veiculos com pendencias:

- `status: "com_pendencias"`: encontrou multa, IPVA, licenciamento ou outro debito indicado na tela.
- `status: "sem_pendencias"`: nao encontrou mensagens de pendencia na tela.
- `status: "erro"`: a consulta daquele veiculo falhou, sem travar o lote.

Ver historico:

```bash
curl -H "x-api-key: troque_essa_chave" http://localhost:3000/historico
```

Ver ultima consulta por placa:

```bash
curl -H "x-api-key: troque_essa_chave" http://localhost:3000/veiculo/ABC1D23
```

No Postman ou Insomnia, configure:

- Method: `POST`
- URL: `http://localhost:3000/consultar`
- Header: `x-api-key: troque_essa_chave`
- Header: `Content-Type: application/json`
- Body JSON:

```json
{
  "placa": "ABC1D23",
  "renavam": "12345678901"
}
```

## Historico e downloads

- Historico: `data/historico.json`
- PDFs, boletos e extratos: `downloads/`
- Screenshots de erro: `downloads/errors/`
- Planilhas enviadas pela tela: `data/uploads/`

## Rodar no Windows

Depois de instalar as dependencias e o Chromium do Playwright, voce pode iniciar com:

```bash
npm start
```

ou dar dois cliques em:

```text
iniciar-api.bat
```

Para deixar rodando em uma maquina interna, use uma solucao de servico/processo como NSSM, PM2 ou Agendador de Tarefas do Windows.

## Monitoramento Diario

Para uso interno sem pagina HTML, edite a planilha definida em `PLANILHA_PATH` e rode:

```bash
npm run monitor
```

Para rodar em backend sem abrir navegador, deixe no `.env`:

```env
HEADLESS=true
```

Parametros de velocidade ajustaveis:

```env
DELAY_ENTRE_CONSULTAS_MS=1500
PLAYWRIGHT_TIMEOUT_MS=20000
PLAYWRIGHT_NAVIGATION_TIMEOUT_MS=45000
PLAYWRIGHT_CLICK_DELAY_MS=500
PLAYWRIGHT_FORM_POLL_MS=300
PLAYWRIGHT_FORM_FIELD_TIMEOUT_MS=700
PLAYWRIGHT_RESULT_DELAY_MS=1200
```

Se o site estiver instavel, aumente `PLAYWRIGHT_CLICK_DELAY_MS`, `PLAYWRIGHT_RESULT_DELAY_MS` ou `DELAY_ENTRE_CONSULTAS_MS`.

Esse comando:

- le a planilha;
- consulta os veiculos em fila;
- salva todas as consultas em `data/historico.json`;
- salva apenas veiculos com pendencias em `data/pendencias-log.json`;
- salva a ultima mensagem pronta para envio em `data/ultima-mensagem.txt`;
- monta uma mensagem de notificacao, por exemplo:

```text
Monitoramento Detran-CE - 07/05/2026, 16:08

2 veiculos com pendencias:

- XXX0000: 1 multa.
- YYY1111: debito de IPVA.
```

Para agendar no Windows de segunda a sexta as 12:00, horario de Brasilia:

```bat
agendar-monitoramento-windows.bat
```

Para testar manualmente:

```bat
rodar-monitoramento.bat
```

### Notificacao Por Email

No `.env`, configure:

```env
NOTIFY_EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=seu_email@gmail.com
SMTP_PASS=sua_senha_de_app
EMAIL_FROM=seu_email@gmail.com
EMAIL_TO=destino1@empresa.com,destino2@empresa.com
```

Para Gmail, use senha de app, nao a senha normal da conta. A tela oficial fica em:

```text
https://myaccount.google.com/apppasswords
```

Para testar apenas o envio de e-mail, sem rodar uma consulta completa:

```bash
node -e "require('dotenv').config(); const { notificarPendencias } = require('./src/notifier'); notificarPendencias([{ placa: 'TESTE123', renavam: '00000000000', status: 'com_pendencias', pendencias: [{ tipo: 'multa', quantidade: 1 }] }]).then(r => { console.log('Email enviado/testado com sucesso'); console.log(r.envios); }).catch(e => { console.error('Falha no teste:', e.message); process.exit(1); });"
```

### Notificacao Por WhatsApp

O projeto deixa pronto um envio por webhook. Isso permite integrar com n8n, Evolution API, Z-API ou outro provedor.

```env
NOTIFY_WEBHOOK_ENABLED=true
NOTIFY_WEBHOOK_URL=https://sua-url-do-webhook
```

O webhook recebe:

```json
{
  "mensagem": "Veiculo de placa XXX0000 possui 1 multa(s).",
  "total": 1,
  "resultados": []
}
```

## Hospedagem Online

Vercel nao e uma boa opcao para esta automacao. O projeto precisa abrir Chromium com Playwright, manter fila de consultas, salvar historico/downloads em disco e pode levar varios minutos por lote. Isso conflita com o modelo serverless da Vercel, que tem timeout e filesystem efemero.

Opcoes mais adequadas:

- rodar localmente em uma maquina da empresa;
- VPS Windows ou Linux;
- servidor interno com Node.js;
- container Docker em Render, Railway, Fly.io ou similar, desde que permita Playwright/Chromium e armazenamento persistente;
- maquina dedicada acessada por VPN ou rede local.

Se for expor na internet, troque `API_KEY`, use HTTPS, restrinja acesso por VPN/firewall e considere fila em background para lotes grandes.

## Ajuste dos seletores do Detran-CE

A automacao fica em `src/detranCeBot.js`. No topo do arquivo existe o objeto `SELECTORS`.

Atualize estes campos quando confirmar os seletores reais do portal:

- `consultaUrl`
- `placaInput`
- `renavamInput`
- `submitButton`
- `resultadoContainer`
- `pendenciaRows`
- `downloadLinks`

Essa separacao foi feita porque o site do Detran-CE pode mudar os nomes dos campos, botoes e tabelas.
