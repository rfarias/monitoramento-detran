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

Estado atual (atualizado em 17/06/2026), configurado direto no Agendador de Tarefas do Windows — nao versionado em arquivo, por isso documentado aqui.

### Tarefa "Monitoramento Detran CE"

- Executa `detran-ce-api/rodar-monitoramento-combinado.bat` (Detran-CE todos os dias + Tacografo somente as segundas).
- Agendamento: segunda a sexta, 12:00 (horario de Brasilia).
- `Hidden = True`: roda sem abrir janela visivel de cmd/PowerShell. O processo termina por conta propria ao fim da execucao — nao ha nada para fechar manualmente.
- O navegador do Playwright tambem roda invisivel (`HEADLESS=true` no `.env`).
- Para editar: `Get-ScheduledTask -TaskName "Monitoramento Detran CE"` / `Set-ScheduledTask`. Essa tarefa ja existia antes e pode ser modificada sem precisar de permissao de administrador.

Para executar manualmente o equivalente (Detran-CE + Tacografo):

```powershell
cd detran-ce-api
.\rodar-monitoramento-combinado.bat
```

Ha tambem `agendar-monitoramento-windows.bat`, que cria uma tarefa nova chamada "Monitoramento Detran e Tacografo" (nome diferente da tarefa "Monitoramento Detran CE" que esta em uso). Criar tarefas novas via `schtasks`/`Register-ScheduledTask` exige PowerShell como Administrador neste ambiente — modificar uma tarefa existente nao exige.

### Evolution API (WhatsApp) — sob demanda, sem tarefa propria

A Evolution API **nao fica mais rodando continuamente**. Antes existia uma tarefa separada ("Evolution API - WhatsApp", gatilho `AtLogOn`) para mante-la sempre de pe, mas isso consumia recursos o tempo todo e dependia de um restart automatico do Task Scheduler que se mostrou pouco confiavel — toda vez que o processo era fechado manualmente (ex.: fechar o cmd), ele nao voltava sozinho e o WhatsApp parava de enviar sem aviso.

A solucao atual: o proprio `notifier.js` (`detran-ce-api/src/evolutionApiManager.js`) sobe a Evolution API **somente no momento de enviar a mensagem de WhatsApp**, espera ela ficar pronta (`state: "open"`), envia, e **encerra o processo em seguida** — tudo dentro da mesma execucao do monitor, sem deixar nada residente.

- `garantirEvolutionApiAtiva()`: se a API ja estiver rodando (ex.: alguem testando manualmente), reaproveita. Caso contrario, inicia `npx tsx ./src/main.ts` dentro de `evolution-api/` via `child_process.spawn` com `windowsHide: true` — nao abre nenhuma janela de cmd/PowerShell. Espera (polling de 2 em 2s, timeout configuravel por `EVOLUTION_API_STARTUP_TIMEOUT_MS`, padrao 60s) at o `connectionState` retornar `"open"`.
- `pararEvolutionApi()`: mata a arvore de processos (`taskkill /PID <pid> /T /F`) logo apos o envio, garantindo que nada fica preso ou ocupando a porta 8080. So mata o processo que ele mesmo iniciou — se a API ja estava rodando externamente, nao toca nela.
- Esse ciclo (subir → enviar → derrubar) acontece em `notificarPendencias`, `notificarTacografo` e `notificarCombinado`, e so e acionado se `WHATSAPP_ENABLED=true` no `.env`.
- A sessao do WhatsApp (login/QR Code) e persistida pela propria Evolution API entre reinicios, entao nao e necessario reconectar a cada execucao.

Testado manualmente em 17/06/2026: subida oculta, envio real de WhatsApp e encerramento automatico, sem deixar processo `node.exe` nem porta 8080 aberta depois.

**Tarefa antiga "Evolution API - WhatsApp": parada, mas ainda existe e ainda esta habilitada.** Como ela tem gatilho `AtLogOn`, ela volta a subir no proximo login do Windows se nao for desabilitada — e isso conflita com o novo fluxo sob demanda. Desabilitar essa tarefa exige PowerShell como Administrador (modificar `Enabled` foi negado em sessao sem elevacao). Para desabilitar:

```powershell
Disable-ScheduledTask -TaskName "Evolution API - WhatsApp"
```

(Pode tambem excluir a tarefa pelo Agendador de Tarefas do Windows, ja que ela nao e mais necessaria.)

Para checar manualmente se o WhatsApp esta saudavel (so funciona enquanto uma execucao estiver no meio do envio, ja que a API nao fica de pe fora disso):

```powershell
netstat -ano | Select-String ":8080" | Select-String "LISTENING"
Invoke-RestMethod -Uri "http://localhost:8080/instance/connectionState/detran-monitor" -Headers @{ apikey = "<EVOLUTION_API_KEY do .env>" }
```

Se quiser testar o envio isoladamente, sem esperar o agendamento:

```powershell
cd detran-ce-api
node -e "require('dotenv').config(); const { notificarCombinado } = require('./src/notifier'); notificarCombinado([{ placa: 'TESTE123', renavam: '00000000000', status: 'com_pendencias', pendencias: [{ tipo: 'multa', quantidade: 1 }] }], []).then(r => console.log(r.envios)).catch(e => console.error(e.message));"
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
