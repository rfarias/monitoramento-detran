require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { lerPlanilha } = require("./spreadsheet");
const { consultarComBrowser, abrirBrowser } = require("./detranCeBot");
const { adicionarConsulta, garantirDiretorios } = require("./storage");
const { notificarPendencias } = require("./notifier");

const PLANILHA_PATH = process.env.PLANILHA_PATH || "./data/veiculos.xlsx";
const MONITOR_CONCORRENCIA = Number(process.env.MONITOR_CONCORRENCIA || 3);
const MONITOR_LOG_PATH = path.resolve(process.env.MONITOR_LOG_PATH || "./data/pendencias-log.json");
const MONITOR_MESSAGE_PATH = path.resolve(process.env.MONITOR_MESSAGE_PATH || "./data/ultima-mensagem.txt");

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
  const limitar = criarLimitador(MONITOR_CONCORRENCIA);
  let consultados = 0;

  console.log(`[Monitor] Iniciando consultas (concorrencia: ${MONITOR_CONCORRENCIA})...`);
  const browser = await abrirBrowser();
  let resultados;
  try {
    const promessas = veiculos.map((veiculo) =>
      limitar(async () => {
        const n = ++consultados;
        console.log(`[Monitor] Consultando ${n}/${veiculos.length}: ${veiculo.placa}`);
        const resultado = await consultarComBrowser(browser, veiculo);
        if (resultado.status === "com_pendencias") {
          console.log(`[Monitor] Pendencia encontrada: ${veiculo.placa}`);
        }
        return resultado;
      })
    );
    resultados = await Promise.all(promessas);
  } finally {
    await browser.close().catch(() => null);
  }

  for (const resultado of resultados) {
    await adicionarConsulta(resultado);
  }

  const resultadosComPendencia = resultados.filter((r) => r.status === "com_pendencias");
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
