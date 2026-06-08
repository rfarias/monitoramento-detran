const fs = require("fs/promises");
const path = require("path");

const HISTORICO_PATH = path.resolve("./data/historico.json");
const HISTORICO_TACOGRAFO_PATH = path.resolve("./data/historico-tacografo.json");

async function garantirDiretorios() {
  await fs.mkdir(path.resolve("./data"), { recursive: true });
  await fs.mkdir(path.resolve("./downloads"), { recursive: true });
  await fs.mkdir(path.resolve("./downloads/errors"), { recursive: true });
}

async function lerHistorico() {
  await garantirDiretorios();

  try {
    const content = await fs.readFile(HISTORICO_PATH, "utf8");
    const historico = JSON.parse(content);
    return Array.isArray(historico) ? historico : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Nao foi possivel ler o historico: ${error.message}`);
  }
}

async function salvarHistorico(historico) {
  await garantirDiretorios();
  await fs.writeFile(HISTORICO_PATH, JSON.stringify(historico, null, 2), "utf8");
}

async function adicionarConsulta(resultado) {
  const historico = await lerHistorico();
  historico.push(resultado);
  await salvarHistorico(historico);
  return resultado;
}

async function obterUltimaConsultaPorPlaca(placa) {
  const historico = await lerHistorico();
  const placaNormalizada = String(placa || "").replace(/[\s-]/g, "").toUpperCase();

  for (let i = historico.length - 1; i >= 0; i -= 1) {
    if (historico[i]?.placa === placaNormalizada) {
      return historico[i];
    }
  }

  return null;
}

async function lerHistoricoTacografo() {
  await garantirDiretorios();

  try {
    const content = await fs.readFile(HISTORICO_TACOGRAFO_PATH, "utf8");
    const historico = JSON.parse(content);
    return Array.isArray(historico) ? historico : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Nao foi possivel ler o historico de tacografo: ${error.message}`);
  }
}

async function salvarHistoricoTacografo(historico) {
  await garantirDiretorios();
  await fs.writeFile(HISTORICO_TACOGRAFO_PATH, JSON.stringify(historico, null, 2), "utf8");
}

async function adicionarConsultaTacografo(resultado) {
  const historico = await lerHistoricoTacografo();
  historico.push(resultado);
  await salvarHistoricoTacografo(historico);
  return resultado;
}

async function obterUltimaConsultaTacografoPorPlaca(placa) {
  const historico = await lerHistoricoTacografo();
  const placaNormalizada = String(placa || "").replace(/[\s-]/g, "").toUpperCase();

  for (let i = historico.length - 1; i >= 0; i -= 1) {
    if (historico[i]?.placa === placaNormalizada) {
      return historico[i];
    }
  }

  return null;
}

module.exports = {
  HISTORICO_PATH,
  HISTORICO_TACOGRAFO_PATH,
  garantirDiretorios,
  lerHistorico,
  adicionarConsulta,
  obterUltimaConsultaPorPlaca,
  lerHistoricoTacografo,
  adicionarConsultaTacografo,
  obterUltimaConsultaTacografoPorPlaca
};
