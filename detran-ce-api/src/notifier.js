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

async function enviarEmail(mensagem, assunto, destinatario) {
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

  const to = destinatario || process.env.EMAIL_TO;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: assunto,
    text: mensagem
  });

  return { sent: true, canal: "email", to };
}

async function enviarWhatsapp(mensagem, destino) {
  if (!envBool("WHATSAPP_ENABLED")) {
    console.log("[WhatsApp] Desabilitado (WHATSAPP_ENABLED=false). Pulando envio.");
    return { skipped: true, canal: "whatsapp" };
  }

  const apiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE;

  if (!apiUrl || !apiKey || !instance) {
    const err = new Error("Config WhatsApp incompleta. Verifique EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE");
    console.error(`[WhatsApp] ${err.message}`);
    throw err;
  }

  if (!destino) {
    const err = new Error("Destino WhatsApp nao informado");
    console.error(`[WhatsApp] ${err.message}`);
    throw err;
  }

  console.log(`[WhatsApp] Enviando para ${destino} via ${apiUrl} (instancia: ${instance})...`);

  let response;
  try {
    response = await fetch(`${apiUrl}/message/sendText/${instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": apiKey },
      body: JSON.stringify({ number: destino, text: mensagem })
    });
  } catch (err) {
    console.error(`[WhatsApp] Falha de conexao com a Evolution API: ${err.message}`);
    throw err;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const err = new Error(`WhatsApp retornou HTTP ${response.status}: ${body}`);
    console.error(`[WhatsApp] ${err.message}`);
    throw err;
  }

  console.log(`[WhatsApp] Enviado com sucesso para ${destino}.`);
  return { sent: true, canal: "whatsapp", to: destino };
}

async function enviarWhatsappParaTodos(mensagem) {
  if (!envBool("WHATSAPP_ENABLED")) {
    console.log("[WhatsApp] Desabilitado (WHATSAPP_ENABLED=false). Pulando envio.");
    return [{ skipped: true, canal: "whatsapp" }];
  }

  const raw = process.env.WHATSAPP_NUMBERS || process.env.WHATSAPP_NUMBER || "";
  const destinos = raw.split(",").map((s) => s.trim()).filter(Boolean);

  if (!destinos.length) {
    const err = new Error("Nenhum numero configurado em WHATSAPP_NUMBERS");
    console.error(`[WhatsApp] ${err.message}`);
    throw err;
  }

  console.log(`[WhatsApp] Enviando para ${destinos.length} destino(s): ${destinos.join(", ")}`);
  const resultados = [];
  for (const destino of destinos) {
    resultados.push(await enviarWhatsapp(mensagem, destino));
  }
  return resultados;
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

async function tentarEnviar(fn, descricao) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[Notifier] Falha ao enviar via ${descricao}: ${err.message}`);
    return { erro: true, canal: descricao, mensagem: err.message };
  }
}

async function notificarPendencias(resultadosComPendencia) {
  const mensagem = formatarMensagemLote(resultadosComPendencia);
  const total = resultadosComPendencia.length;
  const assunto = `Detran-CE: ${total} ${pluralVeiculo(total)}`;
  const envios = [];

  envios.push(await tentarEnviar(() => enviarEmail(mensagem, assunto), "email"));
  envios.push(await tentarEnviar(() => enviarWebhook(mensagem, resultadosComPendencia), "webhook"));
  const whatsResults = await tentarEnviar(() => enviarWhatsappParaTodos(mensagem), "whatsapp");
  if (Array.isArray(whatsResults)) envios.push(...whatsResults);
  else envios.push(whatsResults);

  return { mensagem, envios };
}

function formatarAlertaTacografo(alerta, vencimento) {
  const data = vencimento ? vencimento.split("-").reverse().join("/") : null;
  if (alerta === "vencido") return "certificado vencido";
  if (alerta === "proximo_vencimento") return data
    ? `certificado proximo do vencimento (${data})`
    : "certificado proximo do vencimento";
  if (alerta === "certificado_preliminar") return data
    ? `certificado preliminar ate ${data}`
    : "certificado preliminar";
  if (alerta === "documento_nao_final") return "documento nao e final";
  return alerta;
}

function formatarMensagemVeiculoTacografo(resultado) {
  const alertas = resultado.alertas || [];
  const certComAlerta = (resultado.certificados || []).find(
    (c) => c.alertas && c.alertas.length > 0
  );
  const vencimento = certComAlerta?.vencimento || null;
  const detalhes = alertas.map((a) => formatarAlertaTacografo(a, vencimento));

  if (!detalhes.length) {
    return `- ${resultado.placa}: alerta de tacografo.`;
  }

  return `- ${resultado.placa}: ${detalhes.join("; ")}.`;
}

function formatarMensagemLoteTacografo(resultadosComAlerta) {
  const dataHora = formatarDataHora();

  if (!resultadosComAlerta.length) {
    return `Monitoramento Tacografo - ${dataHora}\n\nNenhum alerta encontrado.`;
  }

  const linhas = resultadosComAlerta.map(formatarMensagemVeiculoTacografo).join("\n");
  const total = resultadosComAlerta.length;
  const pluralStr =
    total === 1 ? "veiculo com alerta de tacografo" : "veiculos com alertas de tacografo";

  return [
    `Monitoramento Tacografo - ${dataHora}`,
    "",
    `${total} ${pluralStr}:`,
    "",
    linhas
  ].join("\n");
}

async function notificarTacografo(resultadosComAlerta) {
  const mensagem = formatarMensagemLoteTacografo(resultadosComAlerta);
  const total = resultadosComAlerta.length;
  const pluralStr =
    total === 1 ? "veiculo com alerta" : "veiculos com alertas";
  const assunto = `Tacografo: ${total} ${pluralStr}`;
  const envios = [];

  envios.push(await tentarEnviar(() => enviarEmail(mensagem, assunto), "email"));
  envios.push(await tentarEnviar(() => enviarWebhook(mensagem, resultadosComAlerta), "webhook"));
  const whatsResults = await tentarEnviar(() => enviarWhatsappParaTodos(mensagem), "whatsapp");
  if (Array.isArray(whatsResults)) envios.push(...whatsResults);
  else envios.push(whatsResults);

  return { mensagem, envios };
}

function formatarMensagemCombinada(resultadosDetran, resultadosTacografo) {
  const dataHora = formatarDataHora();
  const secoes = [];

  if (resultadosDetran.length) {
    const total = resultadosDetran.length;
    const linhas = resultadosDetran.map(formatarMensagemVeiculo).join("\n");
    secoes.push(`[Detran-CE] ${total} ${pluralVeiculo(total)}:\n${linhas}`);
  }

  if (resultadosTacografo.length) {
    const total = resultadosTacografo.length;
    const pluralStr = total === 1 ? "veiculo com alerta" : "veiculos com alertas";
    const linhas = resultadosTacografo.map(formatarMensagemVeiculoTacografo).join("\n");
    secoes.push(`[Tacografo] ${total} ${pluralStr}:\n${linhas}`);
  }

  if (!secoes.length) {
    return `Monitoramento - ${dataHora}\n\nNenhuma pendencia ou alerta encontrado.`;
  }

  return [`Monitoramento - ${dataHora}`, "", ...secoes].join("\n\n");
}

async function notificarCombinado(resultadosDetran, resultadosTacografo) {
  const mensagem = formatarMensagemCombinada(resultadosDetran, resultadosTacografo);
  const totalDetran = resultadosDetran.length;
  const totalTacografo = resultadosTacografo.length;

  let assunto;
  if (totalDetran && totalTacografo) {
    assunto = `Monitoramento: ${totalDetran} Detran / ${totalTacografo} Tacografo`;
  } else if (totalDetran) {
    assunto = `Detran-CE: ${totalDetran} ${pluralVeiculo(totalDetran)}`;
  } else if (totalTacografo) {
    const pluralStr = totalTacografo === 1 ? "veiculo com alerta" : "veiculos com alertas";
    assunto = `Tacografo: ${totalTacografo} ${pluralStr}`;
  } else {
    assunto = "Monitoramento: sem pendencias";
  }

  const envios = [];

  // Email principal para destinatários padrão
  envios.push(await tentarEnviar(() => enviarEmail(mensagem, assunto), "email"));

  // Emails adicionais por placa
  const porEmail = new Map();
  for (const r of resultadosDetran) {
    if (!r.emailAdicional) continue;
    if (!porEmail.has(r.emailAdicional)) porEmail.set(r.emailAdicional, { detran: [], tacografo: [] });
    porEmail.get(r.emailAdicional).detran.push(r);
  }
  for (const r of resultadosTacografo) {
    if (!r.emailAdicional) continue;
    if (!porEmail.has(r.emailAdicional)) porEmail.set(r.emailAdicional, { detran: [], tacografo: [] });
    porEmail.get(r.emailAdicional).tacografo.push(r);
  }

  for (const [emailDest, { detran, tacografo }] of porEmail.entries()) {
    const msgFiltrada = formatarMensagemCombinada(detran, tacografo);
    const tD = detran.length;
    const tT = tacografo.length;
    let assuntoFiltrado;
    if (tD && tT) assuntoFiltrado = `Monitoramento: ${tD} Detran / ${tT} Tacografo`;
    else if (tD) assuntoFiltrado = `Detran-CE: ${tD} ${pluralVeiculo(tD)}`;
    else assuntoFiltrado = `Tacografo: ${tT} ${tT === 1 ? "veiculo com alerta" : "veiculos com alertas"}`;
    envios.push(await tentarEnviar(() => enviarEmail(msgFiltrada, assuntoFiltrado, emailDest), `email:${emailDest}`));
  }

  // WhatsApp global
  const whatsResults = await tentarEnviar(() => enviarWhatsappParaTodos(mensagem), "whatsapp");
  if (Array.isArray(whatsResults)) envios.push(...whatsResults);
  else envios.push(whatsResults);

  // WhatsApp adicional por placa
  const porWhatsapp = new Map();
  for (const r of resultadosDetran) {
    if (!r.whatsappAdicional) continue;
    if (!porWhatsapp.has(r.whatsappAdicional)) porWhatsapp.set(r.whatsappAdicional, { detran: [], tacografo: [] });
    porWhatsapp.get(r.whatsappAdicional).detran.push(r);
  }
  for (const r of resultadosTacografo) {
    if (!r.whatsappAdicional) continue;
    if (!porWhatsapp.has(r.whatsappAdicional)) porWhatsapp.set(r.whatsappAdicional, { detran: [], tacografo: [] });
    porWhatsapp.get(r.whatsappAdicional).tacografo.push(r);
  }
  for (const [dest, { detran, tacografo }] of porWhatsapp.entries()) {
    const msgFiltrada = formatarMensagemCombinada(detran, tacografo);
    envios.push(await tentarEnviar(() => enviarWhatsapp(msgFiltrada, dest), `whatsapp:${dest}`));
  }

  // Webhook
  envios.push(await tentarEnviar(() => enviarWebhook(mensagem, [...resultadosDetran, ...resultadosTacografo]), "webhook"));

  return { mensagem, envios };
}

module.exports = {
  formatarMensagemVeiculo,
  formatarMensagemLote,
  notificarPendencias,
  formatarMensagemVeiculoTacografo,
  formatarMensagemLoteTacografo,
  notificarTacografo,
  formatarMensagemCombinada,
  notificarCombinado
};
