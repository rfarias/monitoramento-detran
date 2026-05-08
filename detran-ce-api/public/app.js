const apiKeyInput = document.querySelector("#apiKey");
const uploadForm = document.querySelector("#uploadForm");
const planilhaInput = document.querySelector("#planilha");
const listarBtn = document.querySelector("#listarBtn");
const consultarBtn = document.querySelector("#consultarBtn");
const statusBox = document.querySelector("#status");
const resultadosBody = document.querySelector("#resultadosBody");

const totalVeiculos = document.querySelector("#totalVeiculos");
const totalPendencias = document.querySelector("#totalPendencias");
const totalSemPendencias = document.querySelector("#totalSemPendencias");
const totalErros = document.querySelector("#totalErros");

apiKeyInput.value = localStorage.getItem("detranApiKey") || "";
apiKeyInput.addEventListener("input", () => {
  localStorage.setItem("detranApiKey", apiKeyInput.value.trim());
});

function apiKey() {
  return apiKeyInput.value.trim();
}

function setLoading(loading) {
  uploadForm.querySelector("button").disabled = loading;
  listarBtn.disabled = loading;
  consultarBtn.disabled = loading;
}

function setStatus(message, error = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", error);
}

async function requestJson(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    "x-api-key": apiKey()
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.erro || `Erro HTTP ${response.status}`);
  }

  return data;
}

function statusBadge(status) {
  if (status === "com_pendencias") return '<span class="badge pending">Com pendências</span>';
  if (status === "erro") return '<span class="badge error">Erro</span>';
  return '<span class="badge clean">Sem pendências</span>';
}

function pendenciasHtml(pendencias = [], erro = null) {
  if (erro) return `<span class="muted">${escapeHtml(erro)}</span>`;
  if (!pendencias.length) return '<span class="muted">-</span>';

  return `<div class="pendencias">${pendencias
    .map((pendencia) => {
      const qtd = pendencia.quantidade ? ` (${pendencia.quantidade})` : "";
      return `<span>${escapeHtml(pendencia.tipo || "pendencia")}${qtd}: ${escapeHtml(
        pendencia.descricao || ""
      )}</span>`;
    })
    .join("")}</div>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function atualizarResumo(resultados) {
  const total = resultados.length;
  const pendentes = resultados.filter((item) => item.status === "com_pendencias").length;
  const erros = resultados.filter((item) => item.status === "erro").length;
  const limpos = resultados.filter((item) => item.status === "sem_pendencias").length;

  totalVeiculos.textContent = total;
  totalPendencias.textContent = pendentes;
  totalSemPendencias.textContent = limpos;
  totalErros.textContent = erros;
}

function renderVeiculos(veiculos) {
  atualizarResumo(veiculos.map((veiculo) => ({ ...veiculo, status: "sem_pendencias" })));
  resultadosBody.innerHTML = veiculos
    .map(
      (veiculo) => `
        <tr>
          <td>${escapeHtml(veiculo.placa)}</td>
          <td>${escapeHtml(veiculo.renavam)}</td>
          <td><span class="badge clean">Carregado</span></td>
          <td><span class="muted">-</span></td>
          <td><span class="muted">-</span></td>
        </tr>
      `
    )
    .join("");
}

function renderResultados(resultados) {
  atualizarResumo(resultados);
  resultadosBody.innerHTML = resultados
    .map(
      (resultado) => `
        <tr>
          <td>${escapeHtml(resultado.placa)}</td>
          <td>${escapeHtml(resultado.renavam)}</td>
          <td>${statusBadge(resultado.status)}</td>
          <td>${pendenciasHtml(resultado.pendencias, resultado.erro)}</td>
          <td>${escapeHtml(resultado.consultadoEm || "-")}</td>
        </tr>
      `
    )
    .join("");
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!apiKey()) {
    setStatus("Informe a chave da API.", true);
    return;
  }

  if (!planilhaInput.files.length) {
    setStatus("Selecione uma planilha .xlsx ou .csv.", true);
    return;
  }

  const formData = new FormData();
  formData.append("planilha", planilhaInput.files[0]);

  setLoading(true);
  setStatus("Enviando planilha...");

  try {
    const data = await requestJson("/upload-planilha", {
      method: "POST",
      body: formData
    });
    renderVeiculos(data.veiculos);
    setStatus(`Planilha carregada: ${data.total} veículo(s).`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
});

listarBtn.addEventListener("click", async () => {
  setLoading(true);
  setStatus("Carregando veículos...");

  try {
    const data = await requestJson("/veiculos");
    renderVeiculos(data.veiculos);
    setStatus(`${data.total} veículo(s) carregado(s).`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
});

consultarBtn.addEventListener("click", async () => {
  setLoading(true);
  setStatus("Consultando veículos. Aguarde o fim da fila...");

  try {
    const data = await requestJson("/consultar-todos", {
      method: "POST"
    });
    renderResultados(data.resultados);
    const pendentes = data.resultados.filter((item) => item.status === "com_pendencias").length;
    setStatus(`Consulta concluída. ${pendentes} veículo(s) com pendência.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
});
