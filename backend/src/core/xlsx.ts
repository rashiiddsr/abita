/** Utilitas Excel (exceljs). Teks dari pengguna selalu disimpan sebagai string (exceljs tidak menjadikannya rumus). */
import ExcelJS from "exceljs";
import { HttpError } from "./http";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 2000;
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function checkUpload(f: { buffer: Buffer; size: number } | undefined): Buffer {
  if (!f || !f.size) throw new HttpError(422, "File kosong.");
  if (f.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "File terlalu besar (maks. 5 MB).");
  return f.buffer;
}

export async function readWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

/** Nilai sel sebagai teks/angka sederhana (rich text, hyperlink, hasil rumus diratakan). */
export function cellValue(v: ExcelJS.CellValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
  }
  return String(v);
}

/** Baris lembar kerja sebagai array nilai (indeks 0 = kolom A), maksimal `limit` baris. */
export function sheetRows(ws: ExcelJS.Worksheet, limit = MAX_ROWS + 4): (string | number | null)[][] {
  const out: (string | number | null)[][] = [];
  for (let r = 1; r <= Math.min(ws.rowCount, limit); r++) {
    const row = ws.getRow(r);
    const vals: (string | number | null)[] = [];
    for (let c = 1; c <= row.cellCount; c++) vals.push(cellValue(row.getCell(c).value));
    out.push(vals);
  }
  return out;
}

export async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FF005A64" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5F3F4" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
}

export { ExcelJS };
