/**
 * Plantilla del aviso de deuda del día 20 (EPT-116, RF16). Solo servidor.
 *
 * Un correo por padre con la deuda pendiente de sus hijos autorizados, por hijo,
 * factura e ítem. Los importes llegan como texto desde PostgreSQL y se suman con
 * enteros (centavos): ningún Number/flotante interviene en el dinero. No lleva adjuntos.
 */
import { z } from "zod";
import { importeRecibo } from "@/services/recibos-pdf";
import { centavos, etiquetaPeriodo, fechaCorta } from "@/services/factura-pdf";

const dinero = z.string().regex(/^\d+(?:\.\d{1,2})?$/u);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

const itemSchema = z.object({
  item_id: z.uuid(),
  concepto: z.enum(["CUOTA", "DEPORTE", "TRANSPORTE", "COMEDOR"]),
  detalle: z.string().min(1).max(300),
  pendiente: dinero,
  en_verificacion: z.boolean(),
});
const facturaSchema = z.object({
  factura_id: z.uuid(),
  periodo: fecha,
  vencimiento: fecha,
  subtotal: dinero,
  en_verificacion: dinero,
  items: z.array(itemSchema).min(1).max(200),
});
const hijoSchema = z.object({
  alumno_id: z.uuid(),
  alumno: z.string().min(1).max(400),
  subtotal: dinero,
  en_verificacion: dinero,
  facturas: z.array(facturaSchema).min(1).max(200),
});

export const datosAvisoDeudaSchema = z.object({
  user_id: z.uuid(),
  padre: z.string().min(1).max(400),
  corte: fecha,
  fecha_programada: fecha,
  hijos: z.array(hijoSchema).min(1).max(50),
  total: dinero,
  total_en_verificacion: dinero,
});
export type DatosAvisoDeuda = z.infer<typeof datosAvisoDeudaSchema>;

const CONCEPTOS = { CUOTA: "Cuota", DEPORTE: "Deporte", TRANSPORTE: "Transporte", COMEDOR: "Comedor" };
const CERO = BigInt(0);

function escapar(s: string): string {
  return s
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

const sumar = (valores: string[]) => valores.reduce((s, v) => s + centavos(v), CERO);

/** Suma exacta: los subtotales y el total del cuerpo salen del mismo conjunto de ítems. */
export function verificarConjuntoDeuda(d: DatosAvisoDeuda): void {
  let total = CERO;
  let verificacion = CERO;
  const items = new Set<string>();
  for (const h of d.hijos) {
    let subHijo = CERO;
    let verifHijo = CERO;
    for (const f of h.facturas) {
      const subFactura = sumar(f.items.map((i) => i.pendiente));
      const verifFactura = sumar(f.items.filter((i) => i.en_verificacion).map((i) => i.pendiente));
      if (subFactura !== centavos(f.subtotal) || verifFactura !== centavos(f.en_verificacion))
        throw new Error("Los subtotales de una factura no coinciden con sus ítems.");
      for (const i of f.items) {
        if (items.has(i.item_id)) throw new Error("Hay ítems repetidos en el aviso.");
        items.add(i.item_id);
        if (centavos(i.pendiente) <= CERO) throw new Error("Hay un ítem sin saldo pendiente en el aviso.");
      }
      subHijo += subFactura;
      verifHijo += verifFactura;
    }
    if (subHijo !== centavos(h.subtotal) || verifHijo !== centavos(h.en_verificacion))
      throw new Error("Los subtotales de un hijo no coinciden con sus facturas.");
    total += subHijo;
    verificacion += verifHijo;
  }
  if (total !== centavos(d.total) || verificacion !== centavos(d.total_en_verificacion))
    throw new Error("Los totales del aviso no coinciden con los ítems.");
  if (total <= CERO) throw new Error("No se arma un aviso sin deuda.");
}

export function armarAvisoDeuda(d: DatosAvisoDeuda): { asunto: string; texto: string; html: string } {
  verificarConjuntoDeuda(d);
  const corte = fechaCorta(d.corte);
  const asunto = `Aviso de deuda pendiente al ${corte} — Educar para Transformar`;
  const hayVerificacion = centavos(d.total_en_verificacion) > CERO;

  const texto: string[] = [
    "Hola:",
    "",
    `Al ${corte} registramos deuda pendiente en las cuotas y servicios de tus hijos.`,
    `Total de deuda: ${importeRecibo(d.total)}`,
    "",
  ];
  const html: string[] = [
    "<p>Hola:</p>",
    `<p>Al <strong>${escapar(corte)}</strong> registramos deuda pendiente en las cuotas y servicios de tus hijos.</p>`,
    `<p><strong>Total de deuda: ${escapar(importeRecibo(d.total))}</strong></p>`,
  ];
  for (const h of d.hijos) {
    texto.push(h.alumno);
    html.push(`<h3>${escapar(h.alumno)}</h3>`);
    for (const f of h.facturas) {
      const periodo = etiquetaPeriodo(f.periodo);
      const cabecera = `${periodo} (vence el ${fechaCorta(f.vencimiento)})`;
      texto.push(`  ${cabecera}`);
      html.push(`<p><strong>${escapar(cabecera)}</strong></p><ul>`);
      for (const i of f.items) {
        const linea = `${CONCEPTOS[i.concepto]} — ${i.detalle}: ${importeRecibo(i.pendiente)}${
          i.en_verificacion ? " (comprobante en verificación)" : ""
        }`;
        texto.push(`    - ${linea}`);
        html.push(`<li>${escapar(linea)}</li>`);
      }
      html.push("</ul>");
    }
    const resumen = `Subtotal de ${h.alumno}: ${importeRecibo(h.subtotal)}`;
    texto.push(`  ${resumen}`, "");
    html.push(`<p>${escapar(resumen)}</p>`);
  }
  if (hayVerificacion) {
    const nota = `De ese total, ${importeRecibo(d.total_en_verificacion)} tiene un comprobante en verificación: sigue pendiente hasta que se apruebe.`;
    texto.push(nota, "");
    html.push(`<p>${escapar(nota)}</p>`);
  }
  texto.push("Educar para Transformar");
  html.push("<p>Educar para Transformar</p>");
  return { asunto, texto: texto.join("\n"), html: html.join("\n") };
}
