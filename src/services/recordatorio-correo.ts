/**
 * Plantilla del recordatorio mensual (EPT-115, HU15-T4). Solo servidor.
 *
 * Un correo por padre con todos sus hijos: cuota, deportes, transporte y comedor
 * por hijo e ítem. Los importes llegan como texto desde PostgreSQL y se suman
 * con enteros (centavos): ningún Number/flotante interviene en el dinero.
 */
import { z } from "zod";
import { importeRecibo } from "@/services/recibos-pdf";
import { centavos, etiquetaPeriodo, fechaCorta, fuenteFacturaSchema } from "@/services/factura-pdf";

const dinero = z.string().regex(/^\d+(?:\.\d{1,2})?$/u);

export const datosRecordatorioSchema = z.object({
  user_id: z.uuid(),
  padre: z.string().min(1).max(400),
  periodo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  fecha_programada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  hijos: z.array(fuenteFacturaSchema).min(1).max(50),
  total_facturado: dinero,
  pagado: dinero,
  en_verificacion: dinero,
  saldo_por_abonar: dinero,
});
export type DatosRecordatorio = z.infer<typeof datosRecordatorioSchema>;

const CONCEPTOS = { CUOTA: "Cuota", DEPORTE: "Deporte", TRANSPORTE: "Transporte", COMEDOR: "Comedor" };

function escapar(s: string): string {
  return s
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

/** Suma exacta y coherencia entre el cuerpo y los adjuntos: mismo conjunto, mismo total. */
export function verificarConjunto(d: DatosRecordatorio): void {
  const suma = (campo: "total" | "pagado" | "en_verificacion" | "pendiente") =>
    d.hijos.reduce((s, h) => s + centavos(h[campo]), BigInt(0));
  if (
    suma("total") !== centavos(d.total_facturado) ||
    suma("pagado") !== centavos(d.pagado) ||
    suma("en_verificacion") !== centavos(d.en_verificacion) ||
    suma("pendiente") !== centavos(d.saldo_por_abonar)
  )
    throw new Error("Los totales del recordatorio no coinciden con las facturas.");
  if (new Set(d.hijos.map((h) => h.factura_id)).size !== d.hijos.length)
    throw new Error("Hay facturas repetidas en el recordatorio.");
  if (d.hijos.some((h) => h.periodo.slice(0, 10) !== d.periodo))
    throw new Error("Hay facturas de otro período en el recordatorio.");
}

export function nombreAdjunto(alumno: string, periodo: string, indice: number): string {
  const base = alumno
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40);
  return `factura-${periodo.slice(0, 7)}-${indice + 1}-${base || "estudiante"}.pdf`;
}

export function armarRecordatorio(d: DatosRecordatorio): { asunto: string; texto: string; html: string } {
  verificarConjunto(d);
  const periodo = etiquetaPeriodo(d.periodo);
  const vencimiento = fechaCorta(d.hijos[0].vencimiento);
  const asunto = `Recordatorio de pago — ${periodo} — Educar para Transformar`;

  const texto: string[] = [
    "Hola:",
    "",
    `Te recordamos que las cuotas y servicios de ${periodo} vencen el ${vencimiento}.`,
    `Saldo por abonar: ${importeRecibo(d.saldo_por_abonar)}`,
    `Total facturado: ${importeRecibo(d.total_facturado)}`,
    "",
  ];
  const html: string[] = [
    "<p>Hola:</p>",
    `<p>Te recordamos que las cuotas y servicios de <strong>${escapar(periodo)}</strong> vencen el <strong>${escapar(vencimiento)}</strong>.</p>`,
    `<p><strong>Saldo por abonar: ${escapar(importeRecibo(d.saldo_por_abonar))}</strong><br>Total facturado: ${escapar(importeRecibo(d.total_facturado))}</p>`,
  ];
  for (const h of d.hijos) {
    texto.push(`${h.alumno}`);
    html.push(`<h3>${escapar(h.alumno)}</h3><ul>`);
    for (const i of h.items) {
      const linea = `${CONCEPTOS[i.concepto]} — ${i.detalle}: ${importeRecibo(i.importe)}`;
      texto.push(`  - ${linea}`);
      html.push(`<li>${escapar(linea)}</li>`);
    }
    const resumen = `Total del hijo: ${importeRecibo(h.total)} | Saldo por abonar: ${importeRecibo(h.pendiente)}`;
    texto.push(`  ${resumen}`, "");
    html.push(`</ul><p>${escapar(resumen)}</p>`);
  }
  if (centavos(d.pagado) > BigInt(0) || centavos(d.en_verificacion) > BigInt(0)) {
    const nota = `Ya abonado: ${importeRecibo(d.pagado)} | En verificación: ${importeRecibo(d.en_verificacion)}`;
    texto.push(nota, "");
    html.push(`<p>${escapar(nota)}</p>`);
  }
  texto.push("Adjuntamos la factura de cada hijo en PDF.", "", "Educar para Transformar");
  html.push("<p>Adjuntamos la factura de cada hijo en PDF.</p>", "<p>Educar para Transformar</p>");
  return { asunto, texto: texto.join("\n"), html: html.join("\n") };
}
