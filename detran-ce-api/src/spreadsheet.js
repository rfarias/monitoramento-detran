const fs = require("fs/promises");
const path = require("path");
const ExcelJS = require("exceljs");
const { parse } = require("csv-parse/sync");
const { validarVeiculo } = require("./validators");

async function arquivoExiste(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function lerPlanilha(planilhaPath) {
  const resolvedPath = path.resolve(planilhaPath);

  if (!(await arquivoExiste(resolvedPath))) {
    throw new Error(`Planilha nao encontrada em: ${resolvedPath}`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  let linhas;

  if (ext === ".xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(resolvedPath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("Planilha Excel sem abas");

    const headers = [];
    worksheet.getRow(1).eachCell((cell, columnNumber) => {
      headers[columnNumber] = String(cell.value || "").trim();
    });

    linhas = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const linha = {};
      headers.forEach((header, columnNumber) => {
        if (!header) return;
        linha[header] = row.getCell(columnNumber).text;
      });
      linhas.push(linha);
    });
  } else if (ext === ".csv") {
    const content = await fs.readFile(resolvedPath, "utf8");
    linhas = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    });
  } else {
    throw new Error("Formato de planilha invalido. Use .xlsx ou .csv");
  }

  const veiculos = [];
  const erros = [];

  linhas.forEach((linha, index) => {
    const placa = linha.placa ?? linha.Placa ?? linha.PLACA;
    const renavam = linha.renavam ?? linha.Renavam ?? linha.RENAVAM;
    const tacografo =
      linha.tacografo ?? linha.Tacografo ?? linha.TACOGRAFO ??
      linha.tem_tacografo ?? linha.temTacografo ?? "";

    if (!placa && !renavam) return;

    const validacao = validarVeiculo({ placa, renavam, tacografo });
    if (validacao.valido) {
      veiculos.push(validacao.veiculo);
    } else {
      erros.push(`Linha ${index + 2}: ${validacao.erros.join("; ")}`);
    }
  });

  if (erros.length) {
    throw new Error(`Planilha invalida: ${erros.join(" | ")}`);
  }

  return veiculos;
}

module.exports = {
  lerPlanilha
};
