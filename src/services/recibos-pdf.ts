/** Solo servidor: PDF derivado exclusivamente de la fuente canónica autorizada. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { z } from "zod";

const dinero = z.string().regex(/^-?\d+(?:\.\d{1,2})?$/u);
const texto = z.string().min(1).max(4000);
export const fuenteReciboSchema = z.object({
  version: z.literal(1),
  institucion: texto,
  recibo_id: z.uuid(),
  numero: z.string().regex(/^[1-9]\d*$/u),
  pago_id: z.uuid(),
  alumno_id: z.uuid(),
  alumno: texto,
  emitido_en: texto,
  aprobado_en: texto.nullable(),
  transferencia: texto.nullable(),
  importe_informado: dinero,
  importe_imputado: dinero,
  diferencia: dinero,
  nota: texto,
  items: z
    .array(
      z.object({
        item_id: z.uuid(),
        factura_id: z.uuid(),
        periodo: texto,
        concepto: texto,
        detalle: texto,
        importe: dinero,
      }),
    )
    .min(1)
    .max(10000),
});
export type FuenteRecibo = z.infer<typeof fuenteReciboSchema>;

export function importeRecibo(valor: string): string {
  const [entero, fraccion = ""] = valor.split(".");
  return `ARS ${entero.replace(/\B(?=(\d{3})+(?!\d))/gu, ".")},${fraccion.padEnd(2, "0")}`;
}
function centavos(v: string): bigint {
  const negativo = v.startsWith("-");
  const [e, d = ""] = v.replace("-", "").split(".");
  return (
    (BigInt(e) * BigInt(100) + BigInt(d.padEnd(2, "0"))) *
    (negativo ? BigInt(-1) : BigInt(1))
  );
}
function instante(iso: string | null): string {
  if (!iso) return "No registrado";
  const fecha = new Date(iso);
  if (!Number.isFinite(fecha.getTime()))
    throw new Error("Fecha canónica inválida");
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "short",
    timeStyle: "short",
  }).format(fecha);
}
let fuente: Promise<Buffer> | undefined;
export async function generarReciboPdf(entrada: unknown): Promise<Uint8Array> {
  const r = fuenteReciboSchema.parse(entrada);
  if (
    r.items.reduce((s, i) => s + centavos(i.importe), BigInt(0)) !==
      centavos(r.importe_imputado) ||
    centavos(r.importe_informado) - centavos(r.importe_imputado) !==
      centavos(r.diferencia)
  )
    throw new Error("Totales canónicos incoherentes");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  fuente ??= readFile(
    path.join(process.cwd(), "mobile/assets/fonts/Outfit_400Regular.ttf"),
  );
  const font = await pdf.embedFont(await fuente, { subset: true });
  pdf.setTitle(`Recibo institucional ${r.numero}`);
  pdf.setAuthor(r.institucion);
  pdf.setCreationDate(new Date(r.emitido_en));
  pdf.setModificationDate(new Date(r.emitido_en));
  let pagina = pdf.addPage([595.28, 841.89]);
  let y = 0;
  const nueva = () => {
    if (y) pagina = pdf.addPage([595.28, 841.89]);
    y = 793;
    pagina.drawText(r.institucion, {
      x: 44,
      y,
      size: 14,
      font,
      color: rgb(0.1, 0.2, 0.25),
    });
    y -= 24;
    pagina.drawText(`Recibo institucional N.º ${r.numero}`, {
      x: 44,
      y,
      size: 12,
      font,
    });
    y -= 30;
  };
  const linea = (s: string, size = 10) => {
    if (y < 60) nueva();
    pagina.drawText(s, { x: 44, y, size, font });
    y -= size + 6;
  };
  // Divide también palabras sin espacios: ninguna descripción puede invadir márgenes.
  const parrafo = (s: string, size = 10) => {
    let actual = "";
    for (const c of s.replace(/[\r\n\t]/gu, " ")) {
      if (font.widthOfTextAtSize(actual + c, size) > 507) {
        linea(actual, size);
        actual = "";
      }
      actual += c;
    }
    if (actual) linea(actual, size);
  };
  nueva();
  parrafo(`Estudiante: ${r.alumno}`, 12);
  parrafo(`Pago: ${r.pago_id}`);
  parrafo(`Emisión: ${instante(r.emitido_en)} (hora argentina)`);
  parrafo(`Aprobación: ${instante(r.aprobado_en)}`);
  parrafo(`Transferencia informada: ${r.transferencia ?? "No informada"}`);
  y -= 10;
  linea("Ítems abonados, importes históricos imputados", 12);
  for (const i of r.items) {
    if (y < 115) nueva();
    parrafo(`${i.concepto}: ${i.detalle}`);
    parrafo(`Período ${i.periodo} | ${importeRecibo(i.importe)}`);
    parrafo(`Factura ${i.factura_id} | Ítem ${i.item_id}`, 8);
    y -= 8;
  }
  if (y < 180) nueva();
  linea(`Total imputado: ${importeRecibo(r.importe_imputado)}`, 12);
  linea(`Importe informado: ${importeRecibo(r.importe_informado)}`);
  linea(`Diferencia (informado - imputado): ${importeRecibo(r.diferencia)}`);
  y -= 8;
  parrafo(r.nota, 9);
  pdf
    .getPages()
    .forEach((p, i) =>
      p.drawText(`Página ${i + 1} de ${pdf.getPageCount()}`, {
        x: 44,
        y: 30,
        size: 8,
        font,
      }),
    );
  const bytes = await pdf.save();
  if (bytes.length > 5 * 1024 * 1024)
    throw new Error("El recibo supera el límite de descarga");
  return bytes;
}
