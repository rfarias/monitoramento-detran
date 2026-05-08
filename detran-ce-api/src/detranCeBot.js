const path = require("path");
const { chromium } = require("playwright");
const { criarResultadoBase } = require("./validators");
const { garantirDiretorios } = require("./storage");

const SELECTORS = {
  // A Central de Veiculos do Detran-CE abre algumas consultas em modal/overlay sem mudar a URL.
  consultaUrl:
    process.env.DETRAN_CONSULTA_URL ||
    process.env.DETRAN_BASE_URL ||
    "https://sistemas.detran.ce.gov.br/central",

  // Fluxo atual informado: Central -> aba Veiculos -> menu Taxas / Multas.
  abaTexto: process.env.DETRAN_ABA_TEXTO || "Veiculos",
  servicoTexto: process.env.DETRAN_SERVICO_TEXTO || "Taxas / Multas",
  abrirAbaVeiculos: [
    "text=Veiculos",
    "text=Veículos",
    "a:has-text('Veiculos')",
    "button:has-text('Veiculos')",
    "li:has-text('Veiculos')",
    "div:has-text('Veiculos')",
    "[class*='tab' i]:has-text('Veiculos')",
    "[role='tab']:has-text('Veiculos')",
    "a:has-text('Veículos')",
    "button:has-text('Veículos')",
    "li:has-text('Veículos')",
    "div:has-text('Veículos')",
    "[class*='tab' i]:has-text('Veículos')",
    "[role='tab']:has-text('Veículos')"
  ],
  abrirConsulta: [
    "text=Taxas / Multas",
    "text=Taxas/Multas",
    "a:has-text('Taxas / Multas')",
    "button:has-text('Taxas / Multas')",
    "li:has-text('Taxas / Multas')",
    "[role='menuitem']:has-text('Taxas / Multas')",
    "a:has-text('Taxas/Multas')",
    "button:has-text('Taxas/Multas')",
    "li:has-text('Taxas/Multas')",
    "[role='menuitem']:has-text('Taxas/Multas')",
    "a:has-text('Taxas')",
    "button:has-text('Taxas')",
    "li:has-text('Taxas')",
    "a:has-text('Multas')",
    "button:has-text('Multas')",
    "li:has-text('Multas')",
    "a:has-text('Licenciamento')",
    "button:has-text('Licenciamento')",
    "a:has-text('Debitos')",
    "button:has-text('Debitos')",
    "a:has-text('Consulta')",
    "button:has-text('Consulta')"
  ],

  // Pontos criticos: estes seletores dependem do portal atual do Detran-CE.
  // Use seletores estaveis do site real quando confirmar os campos no navegador.
  placaInput: [
    "input[name='placa']",
    "input#placa",
    "input[id*='placa' i]",
    "input[name*='placa' i]",
    "input[placeholder*='Placa' i]",
    "input[aria-label*='placa' i]"
  ],
  renavamInput: [
    "input[name='renavam']",
    "input#renavam",
    "input[id*='renavam' i]",
    "input[name*='renavam' i]",
    "input[id*='chassi' i]",
    "input[name*='chassi' i]",
    "input[placeholder*='Renavam' i]",
    "input[placeholder*='Chassi' i]",
    "input[aria-label*='renavam' i]"
  ],
  submitButton: [
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Confirmar')",
    "input[value*='Confirmar' i]",
    "a:has-text('Confirmar')",
    "button:has-text('Consultar')",
    "button:has-text('Pesquisar')",
    "a:has-text('Consultar')",
    "a:has-text('Pesquisar')"
  ],
  resultadoContainer: ["[data-testid='resultado']", "#resultado", ".resultado", ".modal", "main", "body"],
  pendenciaRows: ["table tbody tr", ".pendencia", ".debito", ".multa"],
  downloadLinks: [
    "a:has-text('PDF')",
    "a:has-text('Boleto')",
    "a:has-text('Extrato')",
    "button:has-text('PDF')",
    "button:has-text('Boleto')",
    "button:has-text('Extrato')"
  ]
};

const TIMING = {
  clickDelayMs: Number(process.env.PLAYWRIGHT_CLICK_DELAY_MS || 500),
  formPollMs: Number(process.env.PLAYWRIGHT_FORM_POLL_MS || 300),
  resultDelayMs: Number(process.env.PLAYWRIGHT_RESULT_DELAY_MS || 1200),
  initialLoadDelayMs: Number(process.env.PLAYWRIGHT_INITIAL_LOAD_DELAY_MS || 500)
};

function toBool(value) {
  return String(value).toLowerCase() === "true";
}

function allContexts(page) {
  return [page, ...page.frames()];
}

async function firstVisibleInContext(context, selectors, timeout = 4000) {
  for (const selector of selectors) {
    const locator = context.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout });
      return locator;
    } catch {
      // Tenta o proximo seletor configurado.
    }
  }

  return null;
}

async function firstVisible(page, selectors, timeout = 4000) {
  for (const context of allContexts(page)) {
    const locator = await firstVisibleInContext(context, selectors, timeout);
    if (locator) return { context, locator };
  }

  return null;
}

async function encontrarFormularioConsulta(page) {
  console.log("[Detran-CE] Procurando formulario de placa e chassi/renavam");
  const timeout = Number(process.env.PLAYWRIGHT_FORM_FIELD_TIMEOUT_MS || 700);
  const placa = await firstVisible(page, SELECTORS.placaInput, timeout);
  const renavam = await firstVisible(page, SELECTORS.renavamInput, timeout);
  const submit = await firstVisible(page, SELECTORS.submitButton, timeout);

  if (placa && renavam && submit) {
    return {
      placaInput: placa.locator,
      renavamInput: renavam.locator,
      submitButton: submit.locator
    };
  }

  return null;
}

async function abrirOverlayDeConsulta(page) {
  const triggers = [];

  if (SELECTORS.servicoTexto) {
    if (await clicarPorTexto(page, SELECTORS.servicoTexto, "menu de servico")) {
      const formulario = await encontrarFormularioConsulta(page);
      if (formulario) return formulario;
    }

    const escapedText = SELECTORS.servicoTexto.replace(/'/g, "\\'");
    triggers.push(`a:has-text('${escapedText}')`, `button:has-text('${escapedText}')`);
  }

  triggers.push(...SELECTORS.abrirConsulta);

  for (const selector of triggers) {
    for (const context of allContexts(page)) {
      const trigger = context.locator(selector).first();
      if (!(await trigger.isVisible().catch(() => false))) continue;

      console.log(`[Detran-CE] Abrindo servico pelo seletor: ${selector}`);
      await trigger.click().catch(() => null);
      await page.waitForTimeout(TIMING.clickDelayMs);

      const formulario = await encontrarFormularioConsulta(page);
      if (formulario) return formulario;
    }
  }

  return null;
}

async function clicarPorTexto(page, texto, descricao) {
  if (!texto) return false;

  for (const context of allContexts(page)) {
    const exact = context.getByText(texto, { exact: true }).first();
    if (await exact.isVisible().catch(() => false)) {
      console.log(`[Detran-CE] Clicando em ${descricao} por texto exato: ${texto}`);
      await exact.click().catch(() => null);
      await page.waitForTimeout(TIMING.clickDelayMs);
      return true;
    }

    const partial = context.getByText(texto, { exact: false }).first();
    if (await partial.isVisible().catch(() => false)) {
      console.log(`[Detran-CE] Clicando em ${descricao} por texto parcial: ${texto}`);
      await partial.click().catch(() => null);
      await page.waitForTimeout(TIMING.clickDelayMs);
      return true;
    }
  }

  return false;
}

async function clicarPorRegex(page, regex, descricao) {
  for (const context of allContexts(page)) {
    const locator = context.getByText(regex).first();
    if (!(await locator.isVisible().catch(() => false))) continue;

    console.log(`[Detran-CE] Clicando em ${descricao} por regex: ${regex}`);
    await locator.click().catch(() => null);
    await page.waitForTimeout(TIMING.clickDelayMs);
    return true;
  }

  return false;
}

async function clicarItemMenuPorTextoExato(page, texto, descricao) {
  const alvo = normalizarTextoMenu(texto);

  for (const context of allContexts(page)) {
    const handle = await context
      .locator("a, button, li, [role='menuitem'], [role='button'], span, p")
      .evaluateHandle((elements, expectedText) => {
        function normalize(value) {
          return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s*\/\s*/g, "/")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        }

        const visibleElements = elements
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          })
          .filter((element) => normalize(element.innerText || element.textContent) === expectedText)
          .sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectA.width * rectA.height - rectB.width * rectB.height;
          });

        return visibleElements[0] || null;
      }, alvo)
      .catch(() => null);

    const element = handle ? handle.asElement() : null;
    if (!element) continue;

    console.log(`[Detran-CE] Clicando em ${descricao} por texto normalizado exato: ${texto}`);
    await element.click();
    await page.waitForTimeout(TIMING.clickDelayMs);
    return true;
  }

  return false;
}

async function clicarPrimeiroVisivel(page, selectors, descricao) {
  for (const selector of selectors) {
    for (const context of allContexts(page)) {
      const locator = context.locator(selector).first();
      if (!(await locator.isVisible().catch(() => false))) continue;

      console.log(`[Detran-CE] Clicando em ${descricao}: ${selector}`);
      await locator.click().catch(() => null);
      await page.waitForTimeout(TIMING.clickDelayMs);
      return true;
    }
  }

  return false;
}

function normalizarTextoMenu(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function abrirAbaVeiculos(page) {
  const selectors = [];

  if (SELECTORS.abaTexto) {
    if (await clicarPorTexto(page, SELECTORS.abaTexto, "aba de veiculos")) {
      return true;
    }

    const escapedText = SELECTORS.abaTexto.replace(/'/g, "\\'");
    selectors.push(
      `a:has-text('${escapedText}')`,
      `button:has-text('${escapedText}')`,
      `[role='tab']:has-text('${escapedText}')`
    );
  }

  selectors.push(...SELECTORS.abrirAbaVeiculos);
  return clicarPrimeiroVisivel(page, selectors, "aba de veiculos");
}

async function abrirMenuTaxasMultas(page) {
  if (SELECTORS.servicoTexto) {
    if (await clicarItemMenuPorTextoExato(page, SELECTORS.servicoTexto, "menu Taxas / Multas")) {
      return true;
    }

    if (await clicarPorTexto(page, SELECTORS.servicoTexto, "menu Taxas / Multas")) {
      return true;
    }
  }

  if (await clicarPorRegex(page, /taxas\s*\/?\s*multas/i, "menu Taxas / Multas")) {
    return true;
  }

  return clicarPrimeiroVisivel(page, SELECTORS.abrirConsulta, "menu Taxas / Multas");
}

async function aguardarFormularioConsulta(page, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const formulario = await encontrarFormularioConsulta(page);
    if (formulario) return formulario;
    await page.waitForTimeout(TIMING.formPollMs);
  }

  return null;
}

function limparTexto(texto) {
  return String(texto || "").replace(/\s+/g, " ").trim();
}

function removerAcentos(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizarTextoBusca(texto) {
  return removerAcentos(texto).replace(/\s+/g, " ").trim().toLowerCase();
}

function extrairValor(texto) {
  const match = texto.match(/R\$\s*([\d.]+,\d{2})/);
  if (!match) return null;
  return Number(match[1].replace(/\./g, "").replace(",", "."));
}

function extrairData(texto) {
  const match = texto.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function extrairCodigoBarras(texto) {
  const match = texto.replace(/\D/g, "").match(/\d{44,48}/);
  return match ? match[0] : null;
}

function classificarTipo(texto) {
  const lower = normalizarTextoBusca(texto);
  if (lower.includes("multa")) return "multa";
  if (lower.includes("licenciamento")) return "licenciamento";
  if (lower.includes("ipva")) return "ipva";
  if (lower.includes("taxa")) return "taxa";
  if (lower.includes("debito")) return "debito";
  return "outro";
}

function nomeArquivoSeguro(value) {
  return String(value || "")
    .replace(/[^a-z0-9_.-]/gi, "_")
    .replace(/_+/g, "_");
}

async function capturarPendencias(page) {
  const pendencias = [];

  for (const context of allContexts(page)) {
    for (const rowSelector of SELECTORS.pendenciaRows) {
      const rows = context.locator(rowSelector);
      const count = await rows.count();
      if (!count) continue;

      for (let i = 0; i < count; i += 1) {
        const texto = limparTexto(await rows.nth(i).innerText().catch(() => ""));
        if (!texto || texto.length < 8) continue;

        const lower = texto.toLowerCase();
        const parecePendencia = ["multa", "taxa", "licenciamento", "debito", "ipva", "r$"].some((termo) =>
          lower.includes(termo)
        );
        if (!parecePendencia) continue;

        pendencias.push({
          tipo: classificarTipo(texto),
          descricao: texto,
          valor: extrairValor(texto),
          vencimento: extrairData(texto),
          codigoBarras: extrairCodigoBarras(texto),
          arquivoPdf: null
        });
      }

      if (pendencias.length) return pendencias;
    }
  }

  return pendencias;
}

async function obterTextoVisivel(page) {
  const textos = [];

  for (const context of allContexts(page)) {
    const texto = await context.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    if (texto) textos.push(texto);
  }

  return limparTexto(textos.join(" "));
}

function contarOcorrenciaPorTipo(textoNormalizado, tipo) {
  const tipoPattern = tipo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\\b(\\d+)\\s+${tipoPattern}s?\\b`, "i"),
    new RegExp(`\\b${tipoPattern}s?\\s*[:\\-]?\\s*(\\d+)\\b`, "i"),
    new RegExp(`\\b${tipoPattern}s?\\b.{0,40}\\b(\\d+)\\b`, "i"),
    new RegExp(`\\b(\\d+)\\b.{0,40}\\b${tipoPattern}s?\\b`, "i")
  ];

  for (const pattern of patterns) {
    const match = textoNormalizado.match(pattern);
    if (!match) continue;

    const quantidade = Number(match[1]);
    if (Number.isInteger(quantidade) && quantidade > 0) {
      return quantidade;
    }
  }

  const indicacaoPendencia = new RegExp(`\\b${tipoPattern}s?\\b.{0,80}\\b(pendente|pendencia|debito|em aberto)\\b`, "i");
  return indicacaoPendencia.test(textoNormalizado) ? 1 : 0;
}

function criarPendenciaResumo(tipo, quantidade) {
  const labels = {
    multa: "Multa(s) encontrada(s)",
    ipva: "Pendencia de IPVA",
    licenciamento: "Pendencia de licenciamento"
  };

  return {
    tipo,
    descricao: quantidade > 1 ? `${labels[tipo]}: ${quantidade}` : labels[tipo],
    valor: null,
    vencimento: null,
    codigoBarras: null,
    arquivoPdf: null,
    quantidade
  };
}

function extrairQuantidadeDaMensagem(textoNormalizado, tipo) {
  const tipoPattern = tipo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`possui\\s+(\\d+)\\s+${tipoPattern}s?`, "i"),
    new RegExp(`\\b(\\d+)\\s+${tipoPattern}s?\\b`, "i"),
    new RegExp(`\\b${tipoPattern}s?\\s*[:\\-]?\\s*(\\d+)\\b`, "i")
  ];

  for (const pattern of patterns) {
    const match = textoNormalizado.match(pattern);
    if (!match) continue;

    const quantidade = Number(match[1]);
    if (Number.isInteger(quantidade) && quantidade > 0) return quantidade;
  }

  return 1;
}

function criarPendenciaPorMensagemVermelha(texto) {
  const textoNormalizado = normalizarTextoBusca(texto);
  const tipos = [
    { tipo: "multa", termo: "multa" },
    { tipo: "ipva", termo: "ipva" },
    { tipo: "licenciamento", termo: "licenciamento" }
  ];

  for (const item of tipos) {
    if (!textoNormalizado.includes(item.termo)) continue;

    return {
      tipo: item.tipo,
      descricao: limparTexto(texto),
      valor: null,
      vencimento: null,
      codigoBarras: null,
      arquivoPdf: null,
      quantidade: extrairQuantidadeDaMensagem(textoNormalizado, item.termo),
      origem: "mensagem_vermelha"
    };
  }

  if (/\b(pendencia|debito|em aberto)\b/i.test(textoNormalizado)) {
    return {
      tipo: "debito",
      descricao: limparTexto(texto),
      valor: null,
      vencimento: null,
      codigoBarras: null,
      arquivoPdf: null,
      quantidade: 1,
      origem: "mensagem_vermelha"
    };
  }

  return null;
}

async function capturarMensagensVermelhas(page) {
  const mensagens = [];

  for (const context of allContexts(page)) {
    const itens = await context
      .locator("a, button, [role='button'], [role='alert'], .btn, .alert, li, span, p, div")
      .evaluateAll((elements) => {
        function parseRgb(value) {
          const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
          if (!match) return null;
          return {
            r: Number(match[1]),
            g: Number(match[2]),
            b: Number(match[3])
          };
        }

        function isRed(value) {
          const rgb = parseRgb(value);
          return Boolean(rgb && rgb.r >= 140 && rgb.g <= 120 && rgb.b <= 120);
        }

        function isVisible(element) {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        }

        return elements
          .filter(isVisible)
          .map((element) => {
            const style = window.getComputedStyle(element);
            const className = String(element.className || "");
            const text = String(element.innerText || element.textContent || element.value || "").replace(/\s+/g, " ").trim();
            const red =
              isRed(style.color) ||
              isRed(style.backgroundColor) ||
              isRed(style.borderColor) ||
              /danger|error|erro|vermelh|red/i.test(className);

            return {
              text,
              red,
              area: element.getBoundingClientRect().width * element.getBoundingClientRect().height
            };
          })
          .filter((item) => item.red && item.text && item.text.length > 5)
          .sort((a, b) => a.area - b.area)
          .map((item) => item.text);
      })
      .catch(() => []);

    mensagens.push(...itens);
  }

  return [...new Set(mensagens.map(limparTexto))];
}

function capturarPendenciasMensagensVermelhas(mensagens) {
  return mensagens
    .map(criarPendenciaPorMensagemVermelha)
    .filter(Boolean);
}

function capturarPendenciasResumo(textoResultado) {
  const textoNormalizado = normalizarTextoBusca(textoResultado);
  const pendencias = [];

  const multas = contarOcorrenciaPorTipo(textoNormalizado, "multa");
  const ipva = contarOcorrenciaPorTipo(textoNormalizado, "ipva");
  const licenciamento = contarOcorrenciaPorTipo(textoNormalizado, "licenciamento");

  if (multas > 0) pendencias.push(criarPendenciaResumo("multa", multas));
  if (ipva > 0) pendencias.push(criarPendenciaResumo("ipva", ipva));
  if (licenciamento > 0) pendencias.push(criarPendenciaResumo("licenciamento", licenciamento));

  return pendencias;
}

function mesclarPendencias(pendenciasDetalhadas, pendenciasResumo) {
  const tiposDetalhados = new Set(pendenciasDetalhadas.map((pendencia) => pendencia.tipo));
  const resumoNovo = pendenciasResumo.filter((pendencia) => !tiposDetalhados.has(pendencia.tipo));
  return [...pendenciasDetalhadas, ...resumoNovo];
}

async function baixarArquivosDisponiveis(page, veiculo) {
  const arquivos = [];
  const data = new Date().toISOString().slice(0, 10);

  for (const context of allContexts(page)) {
    for (const selector of SELECTORS.downloadLinks) {
      const links = context.locator(selector);
      const count = await links.count();

      for (let i = 0; i < count; i += 1) {
        const link = links.nth(i);
        if (!(await link.isVisible().catch(() => false))) continue;

        const label = nomeArquivoSeguro(await link.innerText().catch(() => `arquivo_${i + 1}`)) || `arquivo_${i + 1}`;
        const downloadPromise = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
        await link.click().catch(() => null);
        const download = await downloadPromise;

        if (!download) continue;

        const suggested = nomeArquivoSeguro(download.suggestedFilename() || `${label}.pdf`);
        const fileName = `${veiculo.placa}_${data}_${label}_${suggested}`;
        const absolutePath = path.resolve("./downloads", fileName);
        await download.saveAs(absolutePath);
        arquivos.push(`/downloads/${fileName}`);
      }
    }
  }

  return arquivos;
}

async function salvarScreenshotErro(page, veiculo) {
  const data = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${veiculo.placa || "veiculo"}_${data}.png`;
  const absolutePath = path.resolve("./downloads/errors", fileName);
  await page.screenshot({ path: absolutePath, fullPage: true }).catch(() => null);
  return `/downloads/errors/${fileName}`;
}

async function consultarVeiculoDetranCe(veiculo) {
  await garantirDiretorios();

  const browser = await chromium.launch({
    headless: toBool(process.env.HEADLESS ?? "true")
  });

  const context = await browser.newContext({
    acceptDownloads: true
  });

  const page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 45000));

  try {
    console.log(`[Detran-CE] Consultando ${veiculo.placa}`);
    console.log(`[Detran-CE] Abrindo URL: ${SELECTORS.consultaUrl}`);
    await page.goto(SELECTORS.consultaUrl, {
      waitUntil: "commit",
      timeout: Number(process.env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS || 45000)
    });
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(TIMING.initialLoadDelayMs);
    console.log(`[Detran-CE] Pagina carregada: ${page.url()}`);

    console.log("[Detran-CE] Abrindo aba de veiculos.");
    await abrirAbaVeiculos(page);

    console.log("[Detran-CE] Abrindo menu Taxas / Multas.");
    await abrirMenuTaxasMultas(page);

    console.log("[Detran-CE] Aguardando formulario no painel lateral.");
    let formulario = await aguardarFormularioConsulta(page, 15000);

    if (!formulario) {
      console.log("[Detran-CE] Menu principal nao abriu formulario. Tentando seletores alternativos de servico.");
      formulario = await abrirOverlayDeConsulta(page);
    }

    if (!formulario) {
      throw new Error(
        "Nao foi possivel encontrar campos de placa, chassi/renavam ou botao de consulta. Confirme DETRAN_ABA_TEXTO, DETRAN_SERVICO_TEXTO ou atualize SELECTORS em src/detranCeBot.js."
      );
    }

    await formulario.placaInput.fill(veiculo.placa);
    await formulario.renavamInput.fill(veiculo.renavam);

    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => null),
      formulario.submitButton.click()
    ]);
    await page.waitForTimeout(TIMING.resultDelayMs);

    const resultadoContainer = await firstVisible(page, SELECTORS.resultadoContainer, 15000);
    const textoResultadoContainer = limparTexto(
      resultadoContainer ? await resultadoContainer.locator.innerText() : await page.innerText("body")
    );
    const textoResultado = limparTexto(`${textoResultadoContainer} ${await obterTextoVisivel(page)}`);

    const pendenciasDetalhadas = await capturarPendencias(page);
    const mensagensVermelhas = await capturarMensagensVermelhas(page);
    const pendenciasMensagensVermelhas = capturarPendenciasMensagensVermelhas(mensagensVermelhas);
    const pendenciasResumo = capturarPendenciasResumo(textoResultado);
    const pendencias = pendenciasMensagensVermelhas.length
      ? pendenciasMensagensVermelhas
      : mesclarPendencias(pendenciasDetalhadas, pendenciasResumo);
    const arquivos = await baixarArquivosDisponiveis(page, veiculo);

    const semPendencias =
      /nao constam|sem debitos|nada consta|nenhuma pendencia/i.test(textoResultado) ||
      removerAcentos(textoResultado).match(/nao constam|sem debitos|nada consta/iu);

    return criarResultadoBase(veiculo, {
      status: pendencias.length ? "com_pendencias" : semPendencias ? "sem_pendencias" : "sem_pendencias",
      pendencias,
      arquivos,
      erro: null
    });
  } catch (error) {
    console.error(`[Detran-CE] Erro ao consultar ${veiculo.placa}: ${error.message}`);
    const screenshot = await salvarScreenshotErro(page, veiculo);

    return criarResultadoBase(veiculo, {
      status: "erro",
      pendencias: [],
      arquivos: [screenshot].filter(Boolean),
      erro: error.message
    });
  } finally {
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

module.exports = {
  SELECTORS,
  consultarVeiculoDetranCe
};
