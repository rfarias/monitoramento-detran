function normalizarPlaca(placa) {
  return String(placa || "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
}

function normalizarRenavam(renavam) {
  return String(renavam || "")
    .replace(/\D/g, "");
}

function normalizarTemTacografo(valor) {
  const v = String(valor || "").trim().toLowerCase();
  return ["sim", "s", "1", "true", "x", "yes"].includes(v);
}

function normalizarEmailAdicional(valor) {
  const v = String(valor || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : "";
}

function normalizarWhatsappAdicional(valor) {
  const v = String(valor || "").trim();
  if (v.endsWith("@g.us")) return v;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

function validarVeiculo(input) {
  const placa = normalizarPlaca(input?.placa);
  const renavam = normalizarRenavam(input?.renavam);
  const temTacografo = normalizarTemTacografo(input?.tacografo);
  const emailAdicional = normalizarEmailAdicional(input?.email);
  const whatsappAdicional = normalizarWhatsappAdicional(input?.whatsapp);
  const erros = [];

  if (!placa) erros.push("placa e obrigatoria");
  if (!renavam) erros.push("renavam e obrigatorio");
  if (placa && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) {
    erros.push("placa deve estar no formato antigo ou Mercosul, exemplo ABC1234 ou ABC1D23");
  }
  if (renavam && !/^\d{9,11}$/.test(renavam)) {
    erros.push("renavam deve conter entre 9 e 11 digitos");
  }

  return {
    valido: erros.length === 0,
    erros,
    veiculo: { placa, renavam, temTacografo, emailAdicional, whatsappAdicional }
  };
}

function criarResultadoBase(veiculo, overrides = {}) {
  return {
    placa: veiculo.placa,
    renavam: veiculo.renavam,
    consultadoEm: new Date().toISOString(),
    status: "erro",
    pendencias: [],
    arquivos: [],
    erro: null,
    ...overrides
  };
}

module.exports = {
  normalizarPlaca,
  normalizarRenavam,
  validarVeiculo,
  criarResultadoBase
};
