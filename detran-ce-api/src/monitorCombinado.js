require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { lerPlanilha } = require("./spreadsheet");
const { consultarComBrowser, abrirBrowser } = require("./detranCeBot");
const { consultarTacografosEmLote } = require("./tacografoBot");
const { adicionarConsulta, adicionarConsultaTacografo, garantirDiretorios } = require("./storage");
const { notificarCombinado } = require("./notifier");

const PLANILHA_PATH = process.env.PLANILHA_PATH || "./data/veiculos.xlsx";
const MONITOR_CONCORRENCIA = Number(process.env.MONITOR_CONCORRENCIA || 3);
const MONITOR_MAX_TENTATIVAS = Number(process.env.MONITOR_MAX_TENTATIVAS || 2);
const TACOGRAFO_MAX_TENTATIVAS = Number(process.env.TACOGRAFO_MAX_TENTATIVAS || 10);
const MONITOR_RETRY_DELAY_MS = Number(process.env.MONITOR_RETRY_DELAY_MS || 120000);
const MONITOR_LOG_PATH = path.resolve(process.env.MONITOR_LOG_PATH || "./data/pendencias-log.json");
const TACOGRAFO_LOG_PATH = path.resolve(process.env.TACOGRAFO_LOG_PATH || "./data/tacografo-log.json");
const MONITOR_MESSAGE_PATH = path.resolve(process.env.MONITOR_MESSAGE_PATH || "./data/ultima-mensagem.txt");

function toBool(value) {
  return String(value).toLowerCase() === "true";
}

function criarLimitador(concorrencia) {
  let ativos = 0;
  const fila = [];
  return function limitar(fn) {
    return new Promise((resolve, reject) => {
      function executar() {
        ativos++;
        Promise.resolve(fn())
          .then(resolve, reject)
          .finally(() => {
            ativos--;
            if (fila.length > 0) fila.shift()();
          });
      }
      if (ativos < concorrencia) executar();
      else fila.push(executar);
    });
  };
}

async function lerLog(logPath) {
  try {
    const content = await fs.readFile(logPath, "utf8");
    const log = JSON.parse(content);
    return Array.isArray(log) ? log : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function salvarLog(logPath, log) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, JSON.stringify(log, null, 2), "utf8");
}

async function purgarLogs() {
  const agoraMs = Date.now();
  const MS_30_DIAS = 30 * 24 * 60 * 60 * 1000;
  const MS_180_DIAS = 180 * 24 * 60 * 60 * 1000;

  const logDetran = await lerLog(MONITOR_LOG_PATH);
  const logDetranFiltrado = logDetran.filter((e) => {
    const ts = new Date(e.registradoEm || e.consultadoEm).getTime();
    return agoraMs - ts <= MS_30_DIAS;
  });
  if (logDetranFiltrado.length !== logDetran.length) {
    await salvarLog(MONITOR_LOG_PATH, logDetranFiltrado);
    console.log(`[Monitor] Log Detran purgado: ${logDetran.length - logDetranFiltrado.length} entrada(s) removidas (>30 dias).`);
  }

  const logTaco = await lerLog(TACOGRAFO_LOG_PATH);
  const logTacoFiltrado = logTaco.filter((e) => {
    const ts = new Date(e.registradoEm || e.consultadoEm).getTime();
    return agoraMs - ts <= MS_180_DIAS;
  });
  if (logTacoFiltrado.length !== logTaco.length) {
    await salvarLog(TACOGRAFO_LOG_PATH, logTacoFiltrado);
    console.log(`[Monitor] Log Tacografo purgado: ${logTaco.length - logTacoFiltrado.length} entrada(s) removidas (>180 dias).`);
  }
}

async function registrarPendenciasDetran(resultadosComPendencia) {
  if (!resultadosComPendencia.length) return;
  const log = await lerLog(MONITOR_LOG_PATH);
  const dataExecucao = new Date().toISOString();
  resultadosComPendencia.forEach((r) =>
    log.push({
      placa: r.placa,
      renavam: r.renavam,
      consultadoEm: r.consultadoEm,
      registradoEm: dataExecucao,
      status: r.status,
      pendencias: (r.pendencias || []).map((p) => ({
        tipo: p.tipo,
        descricao: p.descricao,
        quantidade: p.quantidade || null,
        valor: p.valor || null,
        vencimento: p.vencimento || null,
        origem: p.origem || null
      })),
      arquivos: r.arquivos || []
    })
  );
  await salvarLog(MONITOR_LOG_PATH, log);
}

async function registrarAlertasTacografo(resultadosComAlerta) {
  if (!resultadosComAlerta.length) return;
  const log = await lerLog(TACOGRAFO_LOG_PATH);
  const dataExecucao = new Date().toISOString();
  resultadosComAlerta.forEach((r) =>
    log.push({
      placa: r.placa,
      consultadoEm: r.consultadoEm,
      registradoEm: dataExecucao,
      status: r.status,
      certificados: r.certificados,
      alertas: r.alertas
    })
  );
  await salvarLog(TACOGRAFO_LOG_PATH, log);
}

async function executarMonitoramentoCombinado() {
  await garantirDiretorios();
  await purgarLogs();

  console.log(`[Monitor] Lendo planilha: ${PLANILHA_PATH}`);
  const veiculos = await lerPlanilha(PLANILHA_PATH);

  // --- Detran ---
  console.log(`[Monitor] Iniciando consultas Detran-CE (concorrencia: ${MONITOR_CONCORRENCIA})...`);
  const detranComPendencia = [];
  const limitar = criarLimitador(MONITOR_CONCORRENCIA);
  let consultados = 0;

  async function consultarLote(browser, lista) {
    const limitar2 = criarLimitador(MONITOR_CONCORRENCIA);
    return Promise.all(
      lista.map((veiculo) =>
        limitar2(async () => {
          const n = ++consultados;
          console.log(`[Monitor Detran] ${n}/${veiculos.length}: ${veiculo.placa}`);
          const resultado = await consultarComBrowser(browser, veiculo);
          if (veiculo.emailAdicional) resultado.emailAdicional = veiculo.emailAdicional;
          if (veiculo.whatsappAdicional) resultado.whatsappAdicional = veiculo.whatsappAdicional;
          if (resultado.status === "com_pendencias") {
            console.log(`[Monitor Detran] Pendencia: ${veiculo.placa}`);
          }
          return resultado;
        })
      )
    );
  }

  let resultados;
  {
    const browser = await abrirBrowser();
    try {
      resultados = await consultarLote(browser, veiculos);
    } finally {
      await browser.close().catch(() => null);
    }
  }

  for (let tentativa = 2; tentativa <= MONITOR_MAX_TENTATIVAS; tentativa++) {
    const indicesErro = resultados.map((r, i) => (r.status === "erro" ? i : -1)).filter((i) => i >= 0);
    if (!indicesErro.length) break;

    const veiculosComErro = indicesErro.map((i) => veiculos[i]);
    const delaySeg = Math.round(MONITOR_RETRY_DELAY_MS / 1000);
    console.log(`[Monitor] ${veiculosComErro.length} veiculo(s) com erro. Tentativa ${tentativa}/${MONITOR_MAX_TENTATIVAS} em ${delaySeg}s...`);
    await new Promise((r) => setTimeout(r, MONITOR_RETRY_DELAY_MS));

    const browser = await abrirBrowser();
    try {
      const retryResultados = await consultarLote(browser, veiculosComErro);
      indicesErro.forEach((origIdx, i) => { resultados[origIdx] = retryResultados[i]; });
    } finally {
      await browser.close().catch(() => null);
    }
  }

  const detranComErro = resultados.filter((r) => r.status === "erro");
  if (detranComErro.length > 0) console.log(`[Monitor Detran] ${detranComErro.length} veiculo(s) permaneceram com erro apos todas as tentativas.`);

  for (const resultado of resultados) {
    await adicionarConsulta(resultado);
  }
  detranComPendencia.push(...resultados.filter((r) => r.status === "com_pendencias"));

  await registrarPendenciasDetran(detranComPendencia);
  console.log(`[Monitor Detran] Concluido. Pendencias: ${detranComPendencia.length}/${veiculos.length}`);

  // --- Tacografo (somente segundas-feiras) ---
  const diasSemana = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
  const diaSemanaAtual = new Date().getDay();
  const ehSegunda = diaSemanaAtual === 1 || toBool(process.env.FORCAR_TACOGRAFO || "false");
  const tacografoComAlerta = [];
  let tacografoComErro = [];
  let veiculosComTacografo = [];

  if (ehSegunda) {
    veiculosComTacografo = veiculos.filter((v) => v.temTacografo);
    console.log(`[Monitor] Iniciando consultas Tacografo (${veiculosComTacografo.length}/${veiculos.length} veiculos com tacografo)...`);
    const placasTacografo = veiculosComTacografo.map((v) => v.placa);
    const tacografoResultados = await consultarTacografosEmLote(placasTacografo);

    for (let tentativa = 2; ; tentativa++) {
      const indicesErro = tacografoResultados.map((r, i) => (r.status === "erro" ? i : -1)).filter((i) => i >= 0);
      if (!indicesErro.length) break;

      if (tentativa > TACOGRAFO_MAX_TENTATIVAS) {
        console.log(`[Monitor Tacografo] ${indicesErro.length} veiculo(s) com erro apos ${TACOGRAFO_MAX_TENTATIVAS} tentativas. Desistindo.`);
        break;
      }

      const placasComErro = indicesErro.map((i) => placasTacografo[i]);
      const delaySeg = Math.round(MONITOR_RETRY_DELAY_MS / 1000);
      console.log(`[Monitor Tacografo] ${placasComErro.length} veiculo(s) com erro. Tentativa ${tentativa} em ${delaySeg}s...`);
      await new Promise((r) => setTimeout(r, MONITOR_RETRY_DELAY_MS));

      const retryResultados = await consultarTacografosEmLote(placasComErro);
      indicesErro.forEach((origIdx, i) => { tacografoResultados[origIdx] = retryResultados[i]; });
    }

    tacografoComErro = tacografoResultados.filter((r) => r.status === "erro");
    if (tacografoComErro.length > 0) console.log(`[Monitor Tacografo] ${tacografoComErro.length} veiculo(s) permaneceram com erro apos todas as tentativas.`);

    for (const resultado of tacografoResultados) {
      await adicionarConsultaTacografo(resultado);
      const veiculo = veiculosComTacografo.find((v) => v.placa === resultado.placa);
      if (veiculo?.emailAdicional) resultado.emailAdicional = veiculo.emailAdicional;
      if (veiculo?.whatsappAdicional) resultado.whatsappAdicional = veiculo.whatsappAdicional;

      if (resultado.status === "com_alertas") {
        tacografoComAlerta.push(resultado);
        console.log(`[Monitor Tacografo] Alerta: ${resultado.placa} [${resultado.alertas.join(", ")}]`);
      }
    }

    await registrarAlertasTacografo(tacografoComAlerta);
    console.log(`[Monitor Tacografo] Concluido. Alertas: ${tacografoComAlerta.length}/${veiculos.length}`);
  } else {
    console.log(`[Monitor] Tacografo ignorado hoje (${diasSemana[diaSemanaAtual]}). Roda somente na segunda-feira.`);
  }

  // --- Notificação única ---
  const notificacao = await notificarCombinado(detranComPendencia, tacografoComAlerta, {
    tacografoExecutado: ehSegunda,
    totalTacografoVerificado: veiculosComTacografo.length,
    detranComErro,
    tacografoComErro
  });

  await fs.mkdir(path.dirname(MONITOR_MESSAGE_PATH), { recursive: true });
  await fs.writeFile(MONITOR_MESSAGE_PATH, notificacao.mensagem, "utf8");

  console.log("[Monitor] Mensagem final:");
  console.log(notificacao.mensagem);

  return {
    detran: { total: veiculos.length, comPendencias: detranComPendencia.length },
    tacografo: { total: veiculos.length, comAlertas: tacografoComAlerta.length }
  };
}

executarMonitoramentoCombinado().catch((error) => {
  console.error(`[Monitor] Falha: ${error.message}`);
  process.exit(1);
});
