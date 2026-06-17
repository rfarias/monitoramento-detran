const path = require("path");
const { spawn, execSync } = require("child_process");

const EVOLUTION_API_DIR = path.resolve(__dirname, "../../evolution-api");
const POLL_INTERVAL_MS = 2000;
const STARTUP_TIMEOUT_MS = Number(process.env.EVOLUTION_API_STARTUP_TIMEOUT_MS || 60000);

let processoAtivo = null;

async function consultarEstado() {
  const apiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE;

  const resp = await fetch(`${apiUrl}/instance/connectionState/${instance}`, {
    headers: { apikey: apiKey }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function aguardarApiPronta(timeoutMs) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    try {
      const data = await consultarEstado();
      if (data?.instance?.state === "open") return true;
    } catch (err) {
      // ainda subindo, tenta novamente
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

async function garantirEvolutionApiAtiva() {
  try {
    const data = await consultarEstado();
    if (data?.instance?.state === "open") {
      console.log("[Evolution API] Ja estava rodando e conectada, reaproveitando.");
      return;
    }
  } catch (err) {
    // nao esta rodando, vamos iniciar
  }

  console.log("[Evolution API] Iniciando processo oculto...");
  processoAtivo = spawn("cmd.exe", ["/c", "npx tsx ./src/main.ts"], {
    cwd: EVOLUTION_API_DIR,
    windowsHide: true,
    stdio: "ignore"
  });
  processoAtivo.on("error", (err) => console.error(`[Evolution API] Erro ao iniciar processo: ${err.message}`));

  const pronta = await aguardarApiPronta(STARTUP_TIMEOUT_MS);
  if (pronta) console.log("[Evolution API] Pronta para enviar mensagens.");
  else console.error("[Evolution API] Nao ficou pronta dentro do tempo limite. Tentando enviar mesmo assim.");
}

function pararEvolutionApi() {
  if (!processoAtivo || processoAtivo.pid == null) return;
  const pid = processoAtivo.pid;
  processoAtivo = null;
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    console.log("[Evolution API] Processo finalizado.");
  } catch (err) {
    console.error(`[Evolution API] Falha ao finalizar processo: ${err.message}`);
  }
}

module.exports = { garantirEvolutionApiAtiva, pararEvolutionApi };
