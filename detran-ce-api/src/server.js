require("dotenv").config();

const express = require("express");
const fs = require("fs/promises");
const multer = require("multer");
const path = require("path");
const { lerPlanilha } = require("./spreadsheet");
const { validarVeiculo, normalizarPlaca } = require("./validators");
const { consultarVeiculoDetranCe } = require("./detranCeBot");
const { garantirDiretorios, lerHistorico, adicionarConsulta, obterUltimaConsultaPorPlaca } = require("./storage");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY;
const PLANILHA_PATH = process.env.PLANILHA_PATH || "./data/veiculos.xlsx";
const DELAY_ENTRE_CONSULTAS_MS = Number(process.env.DELAY_ENTRE_CONSULTAS_MS || 5000);
const UPLOADS_DIR = path.resolve("./data/uploads");
const PLANILHA_ATUAL_PATH = path.resolve("./data/planilha-atual.json");

const upload = multer({
  dest: UPLOADS_DIR,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".xlsx", ".csv"].includes(ext)) {
      return cb(new Error("Envie uma planilha .xlsx ou .csv"));
    }

    return cb(null, true);
  }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.resolve("./public")));
app.use("/downloads", express.static(path.resolve("./downloads")));
app.get("/", (req, res) => {
  res.sendFile(path.resolve("./public/index.html"));
});

function autenticar(req, res, next) {
  if (req.path === "/health") return next();
  if (req.method === "GET" && ["/", "/index.html", "/styles.css", "/app.js"].includes(req.path)) return next();

  if (!API_KEY) {
    return res.status(500).json({ erro: "API_KEY nao configurada no .env" });
  }

  if (req.header("x-api-key") !== API_KEY) {
    return res.status(401).json({ erro: "Chave de API ausente ou invalida" });
  }

  return next();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function obterPlanilhaAtual() {
  try {
    const content = await fs.readFile(PLANILHA_ATUAL_PATH, "utf8");
    const config = JSON.parse(content);
    return config?.path || PLANILHA_PATH;
  } catch {
    return PLANILHA_PATH;
  }
}

async function definirPlanilhaAtual(filePath, originalName) {
  await fs.mkdir(path.dirname(PLANILHA_ATUAL_PATH), { recursive: true });
  await fs.writeFile(
    PLANILHA_ATUAL_PATH,
    JSON.stringify(
      {
        path: filePath,
        originalName,
        atualizadoEm: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
}

app.use(autenticar);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "detran-ce-api",
    timestamp: new Date().toISOString()
  });
});

app.get("/veiculos", async (req, res) => {
  try {
    const planilhaPath = await obterPlanilhaAtual();
    const veiculos = await lerPlanilha(planilhaPath);
    res.json({ total: veiculos.length, veiculos });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.post("/upload-planilha", upload.single("planilha"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ erro: "Arquivo da planilha nao enviado" });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const safeBaseName = path
      .basename(req.file.originalname, ext)
      .replace(/[^a-z0-9_-]/gi, "_")
      .slice(0, 80);
    const finalName = `${Date.now()}_${safeBaseName || "veiculos"}${ext}`;
    const finalPath = path.join(UPLOADS_DIR, finalName);

    await fs.rename(req.file.path, finalPath);

    const veiculos = await lerPlanilha(finalPath);
    await definirPlanilhaAtual(finalPath, req.file.originalname);

    return res.json({
      mensagem: "Planilha enviada com sucesso",
      arquivo: req.file.originalname,
      total: veiculos.length,
      veiculos
    });
  } catch (error) {
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => null);
    }

    return res.status(400).json({ erro: error.message });
  }
});

app.post("/consultar", async (req, res) => {
  const validacao = validarVeiculo(req.body);
  if (!validacao.valido) {
    return res.status(400).json({ erro: validacao.erros.join("; ") });
  }

  const resultado = await consultarVeiculoDetranCe(validacao.veiculo);
  await adicionarConsulta(resultado);

  return res.status(resultado.status === "erro" ? 502 : 200).json(resultado);
});

app.post("/consultar-todos", async (req, res) => {
  try {
    const planilhaPath = await obterPlanilhaAtual();
    const veiculos = await lerPlanilha(planilhaPath);
    const resultados = [];

    for (let i = 0; i < veiculos.length; i += 1) {
      const veiculo = veiculos[i];
      console.log(`[API] Consultando ${i + 1}/${veiculos.length}: ${veiculo.placa}`);

      const resultado = await consultarVeiculoDetranCe(veiculo);
      await adicionarConsulta(resultado);
      resultados.push(resultado);

      if (i < veiculos.length - 1 && DELAY_ENTRE_CONSULTAS_MS > 0) {
        await sleep(DELAY_ENTRE_CONSULTAS_MS);
      }
    }

    res.json({
      total: resultados.length,
      resultados
    });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.get("/historico", async (req, res) => {
  try {
    const historico = await lerHistorico();
    res.json({ total: historico.length, historico });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

app.get("/veiculo/:placa", async (req, res) => {
  try {
    const placa = normalizarPlaca(req.params.placa);
    const ultimaConsulta = await obterUltimaConsultaPorPlaca(placa);

    if (!ultimaConsulta) {
      return res.status(404).json({ erro: `Nenhuma consulta encontrada para a placa ${placa}` });
    }

    return res.json(ultimaConsulta);
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ erro: "Endpoint nao encontrado" });
});

garantirDiretorios()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[API] Detran-CE API rodando em http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error(`[API] Falha ao iniciar: ${error.message}`);
    process.exit(1);
  });
