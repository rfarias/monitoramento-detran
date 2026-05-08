const nodemailer = require("nodemailer");

function envBool(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return ["true", "1", "yes", "sim"].includes(String(value).toLowerCase());
}

function formatarPendencia(pendencia) {
  const quantidade = Number(pendencia.quantidade || 1);

  if (pendencia.tipo === "multa") {
    return quantidade === 1 ? "1 multa" : `${quantidade} multas`;
  }

  if (pendencia.tipo === "ipva") {
    return "debito de IPVA";
  }

  if (pendencia.tipo === "licenciamento") {
    return "debito de licenciamento";
  }

  if (pendencia.tipo === "debito") {
    return "debito encontrado";
  }

  return pendencia.descricao || "pendencia encontrada";
}

function formatarMensagemVeiculo(resultado) {
  const pendencias = resultado.pendencias || [];
  const detalhes = pendencias.map(formatarPendencia);

  if (!detalhes.length) {
    return `- ${resultado.placa}: pendencia encontrada.`;
  }

  return `- ${resultado.placa}: ${detalhes.join("; ")}.`;
}

function formatarDataHora(date = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function pluralVeiculo(total) {
  return total === 1 ? "veiculo com pendencia" : "veiculos com pendencias";
}

function formatarMensagemLote(resultadosComPendencia) {
  const dataHora = formatarDataHora();

  if (!resultadosComPendencia.length) {
    return `Monitoramento Detran-CE - ${dataHora}\n\nNenhuma pendencia encontrada.`;
  }

  const linhas = resultadosComPendencia.map(formatarMensagemVeiculo).join("\n");
  const total = resultadosComPendencia.length;

  return [
    `Monitoramento Detran-CE - ${dataHora}`,
    "",
    `${total} ${pluralVeiculo(total)}:`,
    "",
    linhas
  ].join("\n");
}

async function enviarEmail(mensagem, resultadosComPendencia) {
  if (!envBool("NOTIFY_EMAIL_ENABLED")) return { skipped: true, canal: "email" };

  const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM", "EMAIL_TO"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Config email incompleta. Variaveis ausentes: ${missing.join(", ")}`);
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: envBool("SMTP_SECURE"),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    subject: `Detran-CE: ${resultadosComPendencia.length} ${pluralVeiculo(resultadosComPendencia.length)}`,
    text: mensagem
  });

  return { sent: true, canal: "email" };
}

async function enviarWebhook(mensagem, resultadosComPendencia) {
  if (!envBool("NOTIFY_WEBHOOK_ENABLED")) return { skipped: true, canal: "webhook" };

  if (!process.env.NOTIFY_WEBHOOK_URL) {
    throw new Error("NOTIFY_WEBHOOK_URL nao configurado");
  }

  const response = await fetch(process.env.NOTIFY_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      mensagem,
      total: resultadosComPendencia.length,
      resultados: resultadosComPendencia
    })
  });

  if (!response.ok) {
    throw new Error(`Webhook retornou HTTP ${response.status}`);
  }

  return { sent: true, canal: "webhook" };
}

async function notificarPendencias(resultadosComPendencia) {
  const mensagem = formatarMensagemLote(resultadosComPendencia);
  const envios = [];

  envios.push(await enviarEmail(mensagem, resultadosComPendencia));
  envios.push(await enviarWebhook(mensagem, resultadosComPendencia));

  return {
    mensagem,
    envios
  };
}

module.exports = {
  formatarMensagemVeiculo,
  formatarMensagemLote,
  notificarPendencias
};
