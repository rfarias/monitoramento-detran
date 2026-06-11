require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { lerPlanilha } = require("./spreadsheet");
const { consultarVeiculoDetranCe } = require("./detranCeBot");
const { consultarTacografosEmLote } = require("./tacografoBot");
const { adicionarConsulta, adicionarConsultaTacografo, garantirDiretorios } = require("./storage");
const { notificarCombinado } = require("./notifier");

const PLANILHA_PATH = process.env.PLANILHA_PATH || "./data/veiculos.xlsx";
const DELAY_ENTRE_CONSULTAS_MS = Number(process.env.DELAY_ENTRE_CONSULTAS_MS || 5000);
const MONITOR_LOG_PATH = path.resolve(process.env.MONITOR_LOG_PATH || "./data/pendencias-log.json");
const TACOGRAFO_LOG_PATH = path.resolve(process.env.TACOGRAFO_LOG_PATH || "./data/tacografo-log.json");
const MONITOR_MESSAGE_PATH = path.resolve(process.env.MONITOR_MESSAGE_PATH || "./data/ultima-mensagem.txt");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBool(value) {
  return String(value).toLowerCase() === "true";
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

  console.log(`[Monitor] Lendo planilha: ${PLANILHA_PATH}`);
  const veiculos = await lerPlanilha(PLANILHA_PATH);

  // --- Detran ---
  console.log("[Monitor] Iniciando consultas Detran-CE...");
  const detranComPendencia = [];

  for (let i = 0; i < veiculos.length; i += 1) {
    const veiculo = veiculos[i];
    console.log(`[Monitor Detran] ${i + 1}/${veiculos.length}: ${veiculo.placa}`);

    const resultado = await consultarVeiculoDetranCe(veiculo);
    await adicionarConsulta(resultado);
    if (veiculo.emailAdicional) resultado.emailAdicional = veiculo.emailAdicional;
    if (veiculo.whatsappAdicional) resultado.whatsappAdicional = veiculo.whatsappAdicional;

    if (resultado.status === "com_pendencias") {
      detranComPendencia.push(resultado);
      console.log(`[Monitor Detran] Pendencia: ${veiculo.placa}`);
    }

    if (i < veiculos.length - 1 && DELAY_ENTRE_CONSULTAS_MS > 0) {
      await sleep(DELAY_ENTRE_CONSULTAS_MS);
    }
  }

  await registrarPendenciasDetran(detranComPendencia);
  console.log(`[Monitor Detran] Concluido. Pendencias: ${detranComPendencia.length}/${veiculos.length}`);

  // --- Tacografo (somente segundas-feiras) ---
  const diasSemana = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
  const diaSemanaAtual = new Date().getDay();
  const ehSegunda = diaSemanaAtual === 1 || toBool(process.env.FORCAR_TACOGRAFO || "false");
  const tacografoComAlerta = [];

  if (ehSegunda) {
    const veiculosComTacografo = veiculos.filter((v) => v.temTacografo);
    console.log(`[Monitor] Iniciando consultas Tacografo (${veiculosComTacografo.length}/${veiculos.length} veiculos com tacografo)...`);
    const tacografoResultados = await consultarTacografosEmLote(veiculosComTacografo.map((v) => v.placa));

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
  const notificacao = await notificarCombinado(detranComPendencia, tacografoComAlerta);

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
