#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import XLSX from 'xlsx';

function usage() {
  console.error(
    'Usage: node scripts/xlsx_to_json.mjs <input.xlsx> <output.json> [sheetName]\n' +
      ' - input.xlsx: Path to the source Excel file.\n' +
      ' - output.json: Path to write the JSON array.\n' +
      ' - sheetName (optional): Specific sheet to read; defaults to the first sheet.'
  );
  process.exit(1);
}

async function main() {
  const [inputPath, outputPath, sheetNameArg] = process.argv.slice(2);
  if (!inputPath || !outputPath) usage();

  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);

  if (!fs.existsSync(resolvedInput)) {
    console.error(`Input file not found: ${resolvedInput}`);
    process.exit(2);
  }

  try {
    const wb = XLSX.readFile(resolvedInput, { cellDates: true, raw: false });
    const sheetName = sheetNameArg || wb.SheetNames[0];
    if (!sheetName) {
      console.error('No sheets found in the workbook.');
      process.exit(3);
    }

    const ws = wb.Sheets[sheetName];
    if (!ws) {
      console.error(`Sheet not found: ${sheetName}`);
      process.exit(4);
    }

    // Convert to JSON; first row is used as headers by default.
    const json = XLSX.utils.sheet_to_json(ws, {
      defval: null,
      raw: false,
      blankrows: false,
    });

    // Ensure directory for output exists
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });

    fs.writeFileSync(resolvedOutput, JSON.stringify(json, null, 2), 'utf8');

    console.log(
      `Wrote ${json.length} records from sheet "${sheetName}" to ${resolvedOutput}`
    );
  } catch (err) {
    console.error('Failed to convert XLSX to JSON:', err?.message || err);
    process.exit(5);
  }
}

main();

