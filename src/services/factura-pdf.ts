/**
 * Solo servidor. PDF de FACTURA institucional de un hijo (EPT-115).
 *
 * La fuente es la factura emitida por EPT-104 y sus ítems históricos, no un
 * pago: no exige un pago aprobado, no adjunta comprobantes de transferencia y no
 * asigna numeración fiscal. Distingue el importe facturado del saldo por abonar.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { z } from "zod";
import { importeRecibo } from "@/services/recibos-pdf";

const dinero = z.string().regex(/^\d+(?:\.\d{1,2})?$/u);
const fecha = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-\d{2}/u);
const texto = z.string().min(1).max(4000);

export const fuenteFacturaSchema = z.object({
  factura_id: z.uuid(),
  alumno: texto,
  periodo: fecha,
  vencimiento: fecha,
  generada_en: texto,
  total: dinero,
  pagado: dinero,
  en_verificacion: dinero,
  pendiente: dinero,
  items: z
    .array(
      z.object({
        item_id: z.uuid(),
        concepto: z.enum(["CUOTA", "DEPORTE", "TRANSPORTE", "COMEDOR"]),
        detalle: texto,
        importe: dinero,
        estado_pago: z.enum(["PENDIENTE", "EN_VERIFICACION", "PAGADO"]),
      }),
    )
    .max(2000),
});
export type FuenteFactura = z.infer<typeof fuenteFacturaSchema>;

/** Importe en texto («12.5») a centavos enteros: ningún flotante interviene en el dinero. */
export function centavos(v: string): bigint {
  const [entero, fraccion = ""] = v.split(".");
  return BigInt(entero) * BigInt(100) + BigInt(fraccion.padEnd(2, "0"));
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const CONCEPTOS = { CUOTA: "Cuota", DEPORTE: "Deporte", TRANSPORTE: "Transporte", COMEDOR: "Comedor" };
const ESTADOS = { PENDIENTE: "Pendiente", EN_VERIFICACION: "En verificación", PAGADO: "Pagado" };

/** «2026-11-01» → «noviembre de 2026». Sin husos horarios: solo texto. */
export function etiquetaPeriodo(iso: string): string {
  const [anio, mes] = iso.slice(0, 10).split("-");
  return `${MESES[Number(mes) - 1]} de ${anio}`;
}
/** «2026-11-10» → «10/11/2026». */
export function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

let fuente: Promise<Buffer> | undefined;

export async function generarFacturaPdf(entrada: unknown): Promise<Uint8Array> {
  const f = fuenteFacturaSchema.parse(entrada);
  const suma = f.items.reduce((s, i) => s + centavos(i.importe), BigInt(0));
  const porEstado = (e: string) =>
    f.items.filter((i) => i.estado_pago === e).reduce((s, i) => s + centavos(i.importe), BigInt(0));
  if (
    suma !== centavos(f.total) ||
    porEstado("PAGADO") !== centavos(f.pagado) ||
    porEstado("EN_VERIFICACION") !== centavos(f.en_verificacion) ||
    porEstado("PENDIENTE") !== centavos(f.pendiente)
  )
    throw new Error("Totales de la factura incoherentes");

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Un fallo al leer la fuente no se cachea: el siguiente intento vuelve a leerla.
  fuente ??= readFile(path.join(process.cwd(), "mobile/assets/fonts/Outfit_400Regular.ttf")).catch((e) => {
    fuente = undefined;
    throw e;
  });
  const font = await pdf.embedFont(await fuente, { subset: true });
  const emitida = new Date(f.generada_en);
  if (!Number.isFinite(emitida.getTime())) throw new Error("Fecha canónica inválida");
  pdf.setTitle(`Factura institucional ${etiquetaPeriodo(f.periodo)}`);
  pdf.setAuthor("Educar para Transformar");
  pdf.setCreationDate(emitida);
  pdf.setModificationDate(emitida);

  let pagina = pdf.addPage([595.28, 841.89]);
  let y = 0;
  const nueva = () => {
    if (y) pagina = pdf.addPage([595.28, 841.89]);
    y = 793;
    pagina.drawText("Educar para Transformar", { x: 44, y, size: 14, font, color: rgb(0.1, 0.2, 0.25) });
    y -= 24;
    pagina.drawText(`Factura institucional — ${etiquetaPeriodo(f.periodo)}`, { x: 44, y, size: 12, font });
    y -= 30;
  };
  const linea = (s: string, size = 10) => {
    if (y < 60) nueva();
    pagina.drawText(s, { x: 44, y, size, font });
    y -= size + 6;
  };
  // Divide también palabras sin espacios: ningún texto invade los márgenes.
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
  parrafo(`Estudiante: ${f.alumno}`, 12);
  parrafo(`Período facturado: ${etiquetaPeriodo(f.periodo)}`);
  parrafo(`Vencimiento: ${fechaCorta(f.vencimiento)}`);
  parrafo(`Identificación de la factura: ${f.factura_id}`, 8);
  y -= 10;
  linea("Composición del importe facturado", 12);
  for (const i of f.items) {
    if (y < 90) nueva();
    parrafo(`${CONCEPTOS[i.concepto]}: ${i.detalle}`);
    parrafo(`${importeRecibo(i.importe)} | Estado del ítem: ${ESTADOS[i.estado_pago]}`, 9);
    y -= 6;
  }
  if (y < 190) nueva();
  y -= 6;
  linea(`Total facturado: ${importeRecibo(f.total)}`, 12);
  linea(`Ya abonado: ${importeRecibo(f.pagado)}`);
  linea(`En verificación: ${importeRecibo(f.en_verificacion)}`);
  linea(`Saldo por abonar: ${importeRecibo(f.pendiente)}`, 12);
  y -= 8;
  parrafo(
    "Documento institucional informativo. El importe facturado no cambia con los pagos; el saldo por abonar excluye lo ya abonado y lo que está en verificación. No es un comprobante fiscal.",
    9,
  );
  pdf
    .getPages()
    .forEach((p, i) =>
      p.drawText(`Página ${i + 1} de ${pdf.getPageCount()}`, { x: 44, y: 30, size: 8, font }),
    );
  const bytes = await pdf.save();
  if (bytes.length > 5 * 1024 * 1024) throw new Error("La factura supera el límite de tamaño");
  return bytes;
}
