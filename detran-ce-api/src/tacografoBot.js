require("dotenv").config();

const { chromium: chromiumExtra } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromiumExtra.use(StealthPlugin());

const TACOGRAFO_URL =
  process.env.TACOGRAFO_URL || "https://cronotacografo.rbmlq.gov.br/certificados/consultar";
const DIAS_ALERTA = Number(process.env.TACOGRAFO_DIAS_ALERTA || 15);
const RECAPTCHA_SITEKEY = "6LflVCIoAAAAAGnYVcmj_SIdBOcHDmdnObCeaX1n";

function toBool(value) {
  return String(value).toLowerCase() === "true";
}

function normalizarTexto(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseDateBR(text) {
  const match = String(text || "").match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!match) return null;
  return new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00`);
}

function calcularDiasParaVencer(vencimentoDate) {
  if (!vencimentoDate) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.ceil((vencimentoDate.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

function calcularAlertas(tipoDocumento, diasParaVencer) {
  const alertas = [];
  const tipo = normalizarTexto(tipoDocumento);

  if (tipo && tipo !== "final") {
    alertas.push("documento_nao_final");
  }

  if (diasParaVencer !== null) {
    if (diasParaVencer < 0) {
      alertas.push("vencido");
    } else if (diasParaVencer <= DIAS_ALERTA) {
      alertas.push("proximo_vencimento");
    }
  }

  return alertas;
}

async function extrairIndicesColunas(table) {
  const headerRow = table.locator("thead tr, tr:first-child").first();
  const cells = headerRow.locator("th, td");
  const count = await cells.count().catch(() => 0);

  const headers = [];
  for (let i = 0; i < count; i += 1) {
    headers.push(normalizarTexto(await cells.nth(i).innerText().catch(() => "")));
  }

  return {
    documento: headers.findIndex(
      (h) =>
        h.includes("documento") ||
        h === "tipo" ||
        h.includes("tipo do") ||
        h.includes("certificado")
    ),
    vencimento: headers.findIndex(
      (h) =>
        h.includes("vencimento") ||
        h.includes("validade") ||
        h.includes("vigencia") ||
        h.includes("data de")
    )
  };
}

async function parsearCertificadosDaTabela(page) {
  const certificados = [];
  const tables = page.locator("table");
  const tableCount = await tables.count().catch(() => 0);

  for (let t = 0; t < tableCount; t += 1) {
    const table = tables.nth(t);
    const indices = await extrairIndicesColunas(table).catch(() => ({
      documento: -1,
      vencimento: -1
    }));

    const dataRows = table.locator("tbody tr");
    const rowCount = await dataRows.count().catch(() => 0);

    for (let i = 0; i < rowCount; i += 1) {
      const row = dataRows.nth(i);
      const cells = row.locator("td");
      const cellCount = await cells.count().catch(() => 0);
      if (!cellCount) continue;

      const cellTexts = [];
      for (let j = 0; j < cellCount; j += 1) {
        cellTexts.push((await cells.nth(j).innerText().catch(() => "")).trim());
      }

      if (!cellTexts.some((c) => c.length > 1)) continue;

      let tipoDocumento = indices.documento >= 0 ? (cellTexts[indices.documento] || "") : "";
      let vencimentoText = indices.vencimento >= 0 ? (cellTexts[indices.vencimento] || "") : "";

      if (!vencimentoText || !tipoDocumento) {
        for (const cell of cellTexts) {
          const norm = normalizarTexto(cell);
          if (!vencimentoText && /^\d{2}\/\d{2}\/\d{4}$/.test(cell.trim())) {
            vencimentoText = cell;
          }
          if (!tipoDocumento && (norm === "final" || norm === "provisorio" || norm === "cancelado")) {
            tipoDocumento = cell;
          }
        }
      }

      const vencimentoDate = parseDateBR(vencimentoText);
      const diasParaVencer = calcularDiasParaVencer(vencimentoDate);
      const alertas = calcularAlertas(tipoDocumento, diasParaVencer);

      certificados.push({
        tipoDocumento: tipoDocumento || null,
        vencimento: vencimentoDate ? vencimentoDate.toISOString().slice(0, 10) : null,
        diasParaVencer,
        alertas,
        dadosBrutos: cellTexts.join(" | ")
      });
    }

    if (certificados.length) break;
  }

  return certificados;
}

function montarResultado(placa, certificados, textoNorm) {
  if (
    !certificados.length &&
    /nenhum|nao encontrado|sem resultado|nao ha|nao foram encontrados/.test(textoNorm)
  ) {
    console.log(`[Tacografo] Sem certificados registrados para ${placa}`);
    return {
      placa,
      consultadoEm: new Date().toISOString(),
      status: "sem_certificado",
      certificados: [],
      alertas: [],
      erro: null
    };
  }

  const todosAlertas = [...new Set(certificados.flatMap((c) => c.alertas))];
  console.log(
    `[Tacografo] ${placa}: ${certificados.length} certificado(s), alertas: [${todosAlertas.join(", ") || "nenhum"}]`
  );

  return {
    placa,
    consultadoEm: new Date().toISOString(),
    status: todosAlertas.length ? "com_alertas" : "ok",
    certificados,
    alertas: todosAlertas,
    erro: null
  };
}

function montarResultadoErro(placa, mensagem) {
  return {
    placa,
    consultadoEm: new Date().toISOString(),
    status: "erro",
    certificados: [],
    alertas: [],
    erro: mensagem
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolverComCapsolver(apiKey, pageUrl) {
  const createResp = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task: { type: "ReCaptchaV2TaskProxyLess", websiteURL: pageUrl, websiteKey: RECAPTCHA_SITEKEY }
    })
  });
  const createData = await createResp.json();
  if (createData.errorId) throw new Error(`CapSolver: ${createData.errorDescription}`);
  const { taskId } = createData;
  console.log(`[Tacografo] CapSolver taskId: ${taskId}`);

  for (let i = 0; i < 40; i += 1) {
    await sleep(3000);
    const res = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId })
    });
    const data = await res.json();
    if (data.status === "ready") return data.solution.gRecaptchaResponse;
    if (data.errorId) throw new Error(`CapSolver: ${data.errorDescription}`);
  }
  throw new Error("CapSolver: timeout sem resposta em 120s");
}

async function resolverCom2captcha(apiKey, pageUrl) {
  const submitResp = await fetch(
    `https://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${RECAPTCHA_SITEKEY}&pageurl=${encodeURIComponent(pageUrl)}&json=1`
  );
  const submitData = await submitResp.json();
  if (submitData.status !== 1) throw new Error(`2captcha: ${submitData.request}`);
  const { request: taskId } = submitData;
  console.log(`[Tacografo] 2captcha taskId: ${taskId}`);

  await sleep(15000);
  for (let i = 0; i < 30; i += 1) {
    await sleep(3000);
    const res = await fetch(
      `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`
    );
    const data = await res.json();
    if (data.status === 1) return data.request;
    if (data.request !== "CAPCHA_NOT_READY") throw new Error(`2captcha: ${data.request}`);
  }
  throw new Error("2captcha: timeout sem resposta em ~105s");
}

async function injetarToken(page, token) {
  await page.evaluate((t) => {
    const textarea = document.getElementById("g-recaptcha-response");
    if (textarea) {
      textarea.innerHTML = t;
      textarea.value = t;
    }
    if (typeof window.recaptchaCallback === "function") {
      window.recaptchaCallback(t);
    }
  }, token);
}

async function resolverCaptcha(page) {
  const capsolverKey = process.env.CAPSOLVER_API_KEY;
  const twocaptchaKey = process.env.TWOCAPTCHA_API_KEY;

  if (capsolverKey || twocaptchaKey) {
    const token = capsolverKey
      ? await resolverComCapsolver(capsolverKey, TACOGRAFO_URL)
      : await resolverCom2captcha(twocaptchaKey, TACOGRAFO_URL);
    console.log("[Tacografo] Token recebido, injetando...");
    await injetarToken(page, token);
    await page
      .waitForFunction(
        () => { const btn = document.getElementById("enviar"); return btn && !btn.disabled; },
        { timeout: 10000 }
      )
      .catch(() => null);
  } else {
    // Sem API configurada: aguarda auto-aprovação do Google
    const captchaTimeoutMs = Number(process.env.TACOGRAFO_CAPTCHA_TIMEOUT_MS || 12000);
    await page
      .waitForFunction(
        () => { const btn = document.getElementById("enviar"); return btn && !btn.disabled; },
        { timeout: captchaTimeoutMs }
      )
      .catch(() => null);
  }

  return page
    .evaluate(() => {
      const btn = document.getElementById("enviar");
      return btn ? !btn.disabled : false;
    })
    .catch(() => false);
}

async function consultarPlacaNaPagina(page, placa) {
  console.log(`[Tacografo] Consultando ${placa}`);

  await page.goto(TACOGRAFO_URL, {
    waitUntil: "domcontentloaded",
    timeout: Number(process.env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS || 45000)
  });
  await page.waitForLoadState("load", { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(Number(process.env.PLAYWRIGHT_INITIAL_LOAD_DELAY_MS || 500));

  const placaSelectors = [
    "#CrVerificacaoGruServicoVeiculoPlaca",
    "input.placaBrasil",
    "input[id*='placa' i]",
    "input[name*='placa' i]",
    "input[placeholder*='Placa' i]",
    "input[aria-label*='placa' i]",
    "input[type='text']:first-of-type"
  ];

  let placaInput = null;
  for (const sel of placaSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      placaInput = el;
      console.log(`[Tacografo] Campo de placa encontrado: ${sel}`);
      break;
    }
  }

  if (!placaInput) {
    throw new Error("Campo de placa nao encontrado na pagina do tacografo");
  }

  await placaInput.fill(placa);

  console.log(`[Tacografo] Resolvendo reCAPTCHA para ${placa}...`);
  const aprovado = await resolverCaptcha(page);

  if (!aprovado) {
    throw new Error("reCAPTCHA nao resolvido");
  }

  console.log(`[Tacografo] reCAPTCHA resolvido, submetendo para ${placa}`);
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => null),
    page.locator("button#enviar").click()
  ]);
  await page.waitForTimeout(Number(process.env.PLAYWRIGHT_RESULT_DELAY_MS || 1200));

  const textoResultado = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");

  const certificados = await parsearCertificadosDaTabela(page);
  return montarResultado(placa, certificados, normalizarTexto(textoResultado));
}

// Consulta em lote: um único browser/sessão para todas as placas.
// Os cookies do reCAPTCHA acumulam confiança ao longo da sessão,
// aumentando a taxa de auto-aprovação a partir da primeira verificação.
async function consultarTacografosEmLote(placas) {
  const browser = await chromiumExtra.launch({
    headless: toBool(process.env.HEADLESS ?? "true")
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo"
  });

  const page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 45000));

  const resultados = [];

  try {
    for (const placa of placas) {
      try {
        const resultado = await consultarPlacaNaPagina(page, placa);
        resultados.push(resultado);
      } catch (error) {
        console.error(`[Tacografo] Erro ao consultar ${placa}: ${error.message}`);
        resultados.push(montarResultadoErro(placa, error.message));
      }
    }
  } finally {
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }

  return resultados;
}

// Consulta individual: mantida para uso na API (POST /consultar-tacografo).
async function consultarTacografo(placa) {
  const resultados = await consultarTacografosEmLote([placa]);
  return resultados[0];
}

module.exports = { consultarTacografo, consultarTacografosEmLote };
