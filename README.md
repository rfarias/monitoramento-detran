# Monitoramento Detran-CE

Projeto em Node.js para consultar uma lista de veiculos no portal do Detran-CE, identificar pendencias de taxas, multas e licenciamento, registrar o historico localmente e enviar um resumo por e-mail.

O codigo principal fica em [`detran-ce-api/`](detran-ce-api/README.md).

## Como Funciona

1. A planilha configurada em `PLANILHA_PATH` e lida pelo monitoramento.
2. Cada veiculo e consultado no portal do Detran-CE com Playwright/Chromium.
3. O resultado de cada consulta e salvo no historico local.
4. Veiculos com pendencias sao adicionados ao log de pendencias.
5. Ao final do lote, o sistema monta uma mensagem resumida.
6. Se `NOTIFY_EMAIL_ENABLED=true`, a mensagem e enviada por SMTP.
7. A ultima mensagem tambem fica salva em `data/ultima-mensagem.txt`.

## Estrutura

```text
detran-ce-api/
  src/
    monitor.js       # executa o monitoramento completo
    detranCeBot.js   # automacao do portal Detran-CE
    notifier.js      # envio de e-mail e webhook
    server.js        # API local e tela web
  public/
    index.html       # interface local
```

## Configuracao Inicial

```powershell
cd detran-ce-api
npm install
npm run install-browsers
copy .env.example .env
```

Edite o `.env` com a chave da API, caminho da planilha e configuracoes do Detran.

O arquivo `.env` contem credenciais locais e nao deve ser enviado para o GitHub. Use `.env.example` como modelo.

## Planilha

A planilha deve ter as colunas:

```csv
placa,renavam
ABC1D23,12345678901
XYZ9A88,98765432100
```

O projeto aceita `.xlsx` e `.csv`.

A pasta `data/` nao e enviada para o repositorio. Cada instalacao deve criar sua propria pasta `data/` e colocar a planilha local, por exemplo:

```text
detran-ce-api/data/veiculos.xlsx
```

No `.env`, ajuste o caminho se usar outro nome ou local:

```env
PLANILHA_PATH=./data/veiculos.xlsx
```

## Envio Por Gmail SMTP

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

Para Gmail, use senha de app, nao a senha normal da conta.

Links uteis:

- Senhas de app: https://myaccount.google.com/apppasswords
- Ajuda oficial do Gmail: https://support.google.com/mail/answer/185833

## Testar Apenas O E-mail

```powershell
cd detran-ce-api
node -e "require('dotenv').config(); const { notificarPendencias } = require('./src/notifier'); notificarPendencias([{ placa: 'TESTE123', renavam: '00000000000', status: 'com_pendencias', pendencias: [{ tipo: 'multa', quantidade: 1 }] }]).then(r => { console.log('Email enviado/testado com sucesso'); console.log(r.envios); }).catch(e => { console.error('Falha no teste:', e.message); process.exit(1); });"
```

## Rodar O Monitoramento Completo

```powershell
cd detran-ce-api
npm.cmd run monitor
```

No Windows, `npm.cmd` evita bloqueios de politica de execucao do PowerShell.

Ao finalizar, o monitor imprime um resumo como:

```text
Monitoramento Detran-CE - 08/05/2026, 09:30

2 veiculos com pendencias:

- HUQ8083: debito de licenciamento.
- PMY7F63: 6 multas.
```

## Arquivos Gerados

- `data/historico.json`: historico de consultas.
- `data/pendencias-log.json`: apenas veiculos com pendencias.
- `data/ultima-mensagem.txt`: ultima mensagem gerada para e-mail/webhook.
- `downloads/`: arquivos e evidencias baixadas pelo Playwright.
- `downloads/errors/`: screenshots de erro.

Esses arquivos sao operacionais, assim como a planilha de veiculos, e ficam fora do Git.

## Agendamento No Windows

Para agendar de segunda a sexta as 12:00, horario de Brasilia:

```powershell
cd detran-ce-api
.\agendar-monitoramento-windows.bat
```

Para executar manualmente pelo arquivo `.bat`:

```powershell
cd detran-ce-api
.\rodar-monitoramento.bat
```

## API Local

Tambem existe uma API local e interface web para upload de planilha e consultas manuais:

```powershell
cd detran-ce-api
npm start
```

Depois abra:

```text
http://localhost:3000
```

Mais detalhes tecnicos estao em [`detran-ce-api/README.md`](detran-ce-api/README.md).
