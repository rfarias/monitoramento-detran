require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { lerPlanilha } = require("./spreadsheet");
const { consultarVeiculoDetranCe } = require("./detranCeBot");
const { adicionarConsulta, garantirDiretorios } = require("./storage");
const { notificarPendencias } = require("./notifier");

const PLANILHA_PATH = process.env.PLANILHA_PATH || "./data/veiculos.xlsx";
const DELAY_ENTRE_CONSULTAS_MS = Number(process.env.DELAY_ENTRE_CONSULTAS_MS || 5000);
const MONITOR_LOG_PATH = path.resolve(process.env.MONITOR_LOG_PATH || "./data/pendencias-log.json");
const MONITOR_MESSAGE_PATH = path.resolve(process.env.MONITOR_MESSAGE_PATH || "./data/ultima-mensagem.txt");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lerLogPendencias() {
  try {
    const content = await fs.readFile(MONITOR_LOG_PATH, "utf8");
    const log = JSON.parse(content);
    return Array.isArray(log) ? log : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Nao foi possivel ler o log de pendencias: ${error.message}`);
  }
}

async function salvarLogPendencias(log) {
  await fs.mkdir(path.dirname(MONITOR_LOG_PATH), { recursive: true });
  await fs.writeFile(MONITOR_LOG_PATH, JSON.stringify(log, null, 2), "utf8");
}

async function salvarUltimaMensagem(mensagem) {
  await fs.mkdir(path.dirname(MONITOR_MESSAGE_PATH), { recursive: true });
  await fs.writeFile(MONITOR_MESSAGE_PATH, mensagem, "utf8");
}

function resumirPendencias(resultado) {
  return (resultado.pendencias || []).map((pendencia) => ({
    tipo: pendencia.tipo,
    descricao: pendencia.descricao,
    quantidade: pendencia.quantidade || null,
    valor: pendencia.valor || null,
    vencimento: pendencia.vencimento || null,
    origem: pendencia.origem || null
  }));
}

async function registrarPendencias(resultadosComPendencia) {
  if (!resultadosComPendencia.length) return [];

  const log = await lerLogPendencias();
  const dataExecucao = new Date().toISOString();
  const registros = resultadosComPendencia.map((resultado) => ({
    placa: resultado.placa,
    renavam: resultado.renavam,
    consultadoEm: resultado.consultadoEm,
    registradoEm: dataExecucao,
    status: resultado.status,
    pendencias: resumirPendencias(resultado),
    arquivos: resultado.arquivos || []
  }));

  log.push(...registros);
  await salvarLogPendencias(log);
  return registros;
}

async function executarMonitoramento() {
  await garantirDiretorios();

  console.log(`[Monitor] Lendo planilha: ${PLANILHA_PATH}`);
  const veiculos = await lerPlanilha(PLANILHA_PATH);
  const resultados = [];
  const resultadosComPendencia = [];

  for (let i = 0; i < veiculos.length; i += 1) {
    const veiculo = veiculos[i];
    console.log(`[Monitor] Consultando ${i + 1}/${veiculos.length}: ${veiculo.placa}`);

    const resultado = await consultarVeiculoDetranCe(veiculo);
    await adicionarConsulta(resultado);
    resultados.push(resultado);

    if (resultado.status === "com_pendencias") {
      resultadosComPendencia.push(resultado);
      console.log(`[Monitor] Pendencia encontrada: ${veiculo.placa}`);
    }

    if (i < veiculos.length - 1 && DELAY_ENTRE_CONSULTAS_MS > 0) {
      await sleep(DELAY_ENTRE_CONSULTAS_MS);
    }
  }

  const registros = await registrarPendencias(resultadosComPendencia);
  const notificacao = await notificarPendencias(resultadosComPendencia);
  await salvarUltimaMensagem(notificacao.mensagem);

  console.log(`[Monitor] Finalizado. Consultados: ${resultados.length}. Com pendencias: ${resultadosComPendencia.length}.`);
  console.log(`[Monitor] Registros adicionados ao log: ${registros.length}.`);
  console.log("[Monitor] Mensagem:");
  console.log(notificacao.mensagem);
  console.log(`[Monitor] Mensagem salva em: ${MONITOR_MESSAGE_PATH}`);

  return {
    total: resultados.length,
    comPendencias: resultadosComPendencia.length,
    registros,
    notificacao
  };
}

executarMonitoramento().catch((error) => {
  console.error(`[Monitor] Falha: ${error.message}`);
  process.exit(1);
});
