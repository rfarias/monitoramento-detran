require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { lerPlanilha } = require("./spreadsheet");
const { consultarTacografo } = require("./tacografoBot");
const { adicionarConsultaTacografo, garantirDiretorios } = require("./storage");
const { notificarTacografo } = require("./notifier");

const PLANILHA_PATH = process.env.PLANILHA_PATH || "./data/veiculos.xlsx";
const DELAY_ENTRE_CONSULTAS_MS = Number(process.env.DELAY_ENTRE_CONSULTAS_MS || 5000);
const TACOGRAFO_LOG_PATH = path.resolve(
  process.env.TACOGRAFO_LOG_PATH || "./data/tacografo-log.json"
);
const TACOGRAFO_MESSAGE_PATH = path.resolve(
  process.env.TACOGRAFO_MESSAGE_PATH || "./data/ultima-mensagem-tacografo.txt"
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lerLogTacografo() {
  try {
    const content = await fs.readFile(TACOGRAFO_LOG_PATH, "utf8");
    const log = JSON.parse(content);
    return Array.isArray(log) ? log : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Nao foi possivel ler o log de tacografo: ${error.message}`);
  }
}

async function salvarLogTacografo(log) {
  await fs.mkdir(path.dirname(TACOGRAFO_LOG_PATH), { recursive: true });
  await fs.writeFile(TACOGRAFO_LOG_PATH, JSON.stringify(log, null, 2), "utf8");
}

async function salvarUltimaMensagem(mensagem) {
  await fs.mkdir(path.dirname(TACOGRAFO_MESSAGE_PATH), { recursive: true });
  await fs.writeFile(TACOGRAFO_MESSAGE_PATH, mensagem, "utf8");
}

async function registrarAlertas(resultadosComAlerta) {
  if (!resultadosComAlerta.length) return [];

  const log = await lerLogTacografo();
  const dataExecucao = new Date().toISOString();
  const registros = resultadosComAlerta.map((resultado) => ({
    placa: resultado.placa,
    consultadoEm: resultado.consultadoEm,
    registradoEm: dataExecucao,
    status: resultado.status,
    certificados: resultado.certificados,
    alertas: resultado.alertas
  }));

  log.push(...registros);
  await salvarLogTacografo(log);
  return registros;
}

async function executarMonitoramentoTacografo() {
  await garantirDiretorios();

  console.log(`[Monitor Tacografo] Lendo planilha: ${PLANILHA_PATH}`);
  const veiculos = await lerPlanilha(PLANILHA_PATH);
  const resultados = [];
  const resultadosComAlerta = [];

  for (let i = 0; i < veiculos.length; i += 1) {
    const veiculo = veiculos[i];
    console.log(
      `[Monitor Tacografo] Consultando ${i + 1}/${veiculos.length}: ${veiculo.placa}`
    );

    const resultado = await consultarTacografo(veiculo.placa);
    await adicionarConsultaTacografo(resultado);
    resultados.push(resultado);

    if (resultado.status === "com_alertas") {
      resultadosComAlerta.push(resultado);
      console.log(
        `[Monitor Tacografo] Alerta: ${veiculo.placa} [${resultado.alertas.join(", ")}]`
      );
    }

    if (i < veiculos.length - 1 && DELAY_ENTRE_CONSULTAS_MS > 0) {
      await sleep(DELAY_ENTRE_CONSULTAS_MS);
    }
  }

  const registros = await registrarAlertas(resultadosComAlerta);
  const notificacao = await notificarTacografo(resultadosComAlerta);
  await salvarUltimaMensagem(notificacao.mensagem);

  console.log(
    `[Monitor Tacografo] Finalizado. Consultados: ${resultados.length}. Com alertas: ${resultadosComAlerta.length}.`
  );
  console.log(`[Monitor Tacografo] Registros adicionados ao log: ${registros.length}.`);
  console.log("[Monitor Tacografo] Mensagem:");
  console.log(notificacao.mensagem);
  console.log(`[Monitor Tacografo] Mensagem salva em: ${TACOGRAFO_MESSAGE_PATH}`);

  return {
    total: resultados.length,
    comAlertas: resultadosComAlerta.length,
    registros,
    notificacao
  };
}

executarMonitoramentoTacografo().catch((error) => {
  console.error(`[Monitor Tacografo] Falha: ${error.message}`);
  process.exit(1);
});
