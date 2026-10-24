import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import { readFile, writeFile } from "node:fs/promises";
import { generarReciboPdf, importeRecibo } from "@/services/recibos-pdf";
const id = (n: number) =>
  `b1130000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fuente = (cantidad = 2) => ({
  version: 1,
  institucion: "Educar para Transformar",
  recibo_id: id(1),
  numero: "9007199254740993",
  pago_id: id(2),
  alumno_id: id(3),
  alumno: "Muñoz, María José con un apellido extenso y acentuado",
  emitido_en: "2026-10-19T16:00:00Z",
  aprobado_en: "2026-10-18T16:00:00Z",
  transferencia: "2026-10-17",
  importe_informado: `${cantidad * 500 - 10}.00`,
  importe_imputado: `${cantidad * 500}.00`,
  diferencia: "-10.00",
  nota: "Recibo institucional, no comprobante fiscal. Datos disponibles al emitir.",
  items: Array.from({ length: cantidad }, (_, n) => ({
    item_id: id(100 + n),
    factura_id: id(200 + n),
    periodo: "2026-10-01",
    concepto: "CUOTA",
    detalle: `Educación, natación y acompañamiento del estudiante ${"concepto extenso ".repeat(8)}`,
    importe: "500.00",
  })),
});

test("PDF real: acentos, numeración exacta, importes históricos y varias páginas sin pérdida", async () => {
  const bytes = await generarReciboPdf(fuente(75));
  expect(bytes).toEqual(
    new Uint8Array(
      await readFile("docs/parte3/EPT-113/evidencia/recibo-sintetico.pdf"),
    ),
  );
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(4);
  const extraido = await extractText(bytes.slice(), { mergePages: true });
  expect(extraido.text).toContain("María José");
  expect(extraido.text).toContain("9007199254740993");
  expect(extraido.text).toContain("ARS 37.500,00");
  expect(extraido.text).toContain("ARS 37.490,00");
  expect(extraido.text).toContain("ARS -10,00");
  for (let n = 0; n < 75; n++) expect(extraido.text).toContain(id(100 + n));
  expect(extraido.text).toContain(
    `Página ${pdf.getPageCount()} de ${pdf.getPageCount()}`,
  );
  expect(Buffer.from(bytes).toString("latin1")).not.toMatch(
    /JavaScript|Launch|EmbeddedFile/u,
  );
  if (process.env.EPT_RECIBO_MUESTRA_PATH)
    await writeFile(process.env.EPT_RECIBO_MUESTRA_PATH, bytes);
});
test("rechaza fuente incoherente y conserva cálculo decimal exacto", async () => {
  expect(importeRecibo("9007199254740993.01")).toBe(
    "ARS 9.007.199.254.740.993,01",
  );
  await expect(
    generarReciboPdf({ ...fuente(), importe_imputado: "999.99" }),
  ).rejects.toThrow("Totales canónicos");
  await expect(generarReciboPdf({ ...fuente(), items: [] })).rejects.toThrow();
});
