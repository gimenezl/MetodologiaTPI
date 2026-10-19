import type { Database } from "@/types/database.generated";
import { z } from "zod";
import { createServerSupabaseClient } from "@/services/supabase.server";
import { DescargarRecibo } from "./DescargarRecibo";
import { importeRecibo } from "@/services/recibos-pdf";

export type FiltrosHistorial = {
  hijo?: string;
  desde?: string;
  hasta?: string;
  criterio?: string;
  paginaHistorial?: string;
};
const itemSchema = z.object({
  item_id: z.uuid(),
  factura_id: z.uuid(),
  periodo: z.string(),
  concepto: z.string(),
  importe_centavos: z.string().regex(/^\d+$/u),
  activa: z.boolean(),
});
const deCentavos = (v: string | number) => {
  const original = BigInt(v);
  const c = original < 0 ? -original : original;
  return importeRecibo(
    `${original < 0 ? "-" : ""}${c / BigInt(100)}.${String(c % BigInt(100)).padStart(2, "0")}`,
  );
};

/** Extiende las superficies existentes; el estudiante nunca elige una identidad. */
export async function HistorialPagos({
  alumnos,
  filtros,
  ruta,
  estudiante = false,
  director = false,
}: {
  alumnos: Array<{ id: string; nombre: string }>;
  filtros: FiltrosHistorial;
  ruta: string;
  estudiante?: boolean;
  director?: boolean;
}) {
  const anio = new Date().getFullYear();
  const desde = filtros.desde ?? `${anio}-01-01`;
  const hasta = filtros.hasta ?? `${anio}-12-31`;
  const criterio = filtros.criterio ?? "PERIODO_FACTURA";
  const alumno = estudiante
    ? alumnos[0]?.id
    : director
      ? filtros.hijo
      : (alumnos.find((a) => a.id === filtros.hijo)?.id ?? alumnos[0]?.id);
  const pagina = /^\d{1,6}$/u.test(filtros.paginaHistorial ?? "")
    ? Math.max(1, Number(filtros.paginaHistorial))
    : 1;
  const valido =
    z.iso.date().safeParse(desde).success &&
    z.iso.date().safeParse(hasta).success &&
    desde <= hasta &&
    ["PERIODO_FACTURA", "FECHA_TRANSFERENCIA"].includes(criterio);
  const cliente = await createServerSupabaseClient();
  const respuesta =
    alumno && z.uuid().safeParse(alumno).success && valido
      ? await cliente
          .rpc("consultar_registro_comprobantes", {
            p_alumno_id: alumno,
            p_criterio: criterio,
            p_desde: desde,
            p_hasta: hasta,
          })
          .range((pagina - 1) * 100, pagina * 100)
      : null;
  const datos = (respuesta?.data?.slice(0, 100) ??
    []) as Database["public"]["Functions"]["consultar_registro_comprobantes"]["Returns"];
  const mas = (respuesta?.data?.length ?? 0) > 100;
  const enlace = (p: number) =>
    `${ruta}?${new URLSearchParams({ ...(estudiante ? {} : { hijo: alumno ?? "" }), desde, hasta, criterio, paginaHistorial: String(p) })}`;
  return (
    <section className="space-y-4 mt-8" aria-label="Historial de pagos">
      <h2 className="text-xl font-bold">Historial de pagos y recibos</h2>
      <form action={ruta} className="flex flex-wrap items-end gap-3">
        {!estudiante ? (
          <label>
            Estudiante
            {director ? (
              <input
                name="hijo"
                defaultValue={alumno}
                placeholder="Identificador del estudiante"
                required
                className="block border rounded-xl min-h-11 px-3"
              />
            ) : (
              <select
                name="hijo"
                defaultValue={alumno}
                className="block border rounded-xl min-h-11 px-3"
              >
                {alumnos.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </select>
            )}
          </label>
        ) : null}
        <label>
          Desde
          <input
            type="date"
            name="desde"
            defaultValue={desde}
            required
            className="block border rounded-xl min-h-11 px-3"
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            name="hasta"
            defaultValue={hasta}
            required
            className="block border rounded-xl min-h-11 px-3"
          />
        </label>
        <label>
          Filtrar por
          <select
            name="criterio"
            defaultValue={criterio}
            className="block border rounded-xl min-h-11 px-3"
          >
            <option value="PERIODO_FACTURA">Período de factura</option>
            <option value="FECHA_TRANSFERENCIA">Fecha de transferencia</option>
          </select>
        </label>
        <button className="min-h-11 rounded-xl bg-primary-700 px-4 text-white">
          Consultar historial
        </button>
      </form>
      <p className="text-sm">
        El período de factura y la fecha de transferencia son filtros
        diferentes. Los importes informados no se suman a los imputados. El
        recibo institucional no contiene el comprobante original.
      </p>
      {!valido ? (
        <p role="alert">Elige un rango de fechas y un criterio válidos.</p>
      ) : respuesta?.error ? (
        <p role="alert">
          No se pudo consultar el historial. Reintenta con el mismo formulario.
        </p>
      ) : !datos.length ? (
        <p>No hay pagos para el estudiante y rango seleccionados.</p>
      ) : null}
      <ul className="space-y-4">
        {datos.map((r) => {
          const items = z.array(itemSchema).safeParse(r.items);
          return (
            <li
              key={r.pago_id}
              className="border border-neutral-200 rounded-xl p-4 space-y-2"
            >
              <h3 className="font-semibold">Pago {r.pago_id}</h3>
              <p>Estado: {r.estado}</p>
              <p>Transferencia: {r.fecha_transferencia ?? "No informada"}</p>
              <p>
                Importe informado:{" "}
                {r.importe_informado_centavos === null
                  ? "No informado"
                  : deCentavos(r.importe_informado_centavos)}
              </p>
              <p>
                {r.estado === "APROBADO"
                  ? "Importe imputado"
                  : "Importe seleccionado, no abonado"}
                : {deCentavos(r.total_calculado_centavos)}
              </p>
              {r.importe_informado_centavos !== null ? (
                <p>
                  Diferencia (informado menos imputado o seleccionado):{" "}
                  {deCentavos(
                    String(
                      BigInt(r.importe_informado_centavos) -
                        BigInt(r.total_calculado_centavos),
                    ),
                  )}
                </p>
              ) : null}
              <h4>
                {r.estado === "APROBADO"
                  ? "Ítems abonados"
                  : "Ítems seleccionados, no abonados"}
              </h4>
              {items.success ? (
                <ul>
                  {items.data.map((i) => (
                    <li key={i.item_id}>
                      {i.concepto} · {i.periodo} ·{" "}
                      {deCentavos(i.importe_centavos)} · Factura {i.factura_id}
                      {!i.activa ? " · Imputación histórica inactiva" : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p role="alert">No se pudo validar el detalle de ítems.</p>
              )}
              {r.motivo_rechazo ? (
                <p>Motivo del rechazo: {r.motivo_rechazo}</p>
              ) : null}
              {r.verificado_en ? <p>Verificación: {r.verificado_en}</p> : null}
              {r.estado === "APROBADO" ? (
                r.recibo_id ? (
                  <DescargarRecibo reciboId={r.recibo_id} />
                ) : (
                  <p>
                    Recibo preparándose. Consulta nuevamente o contacta a
                    Dirección.
                  </p>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
      <nav aria-label="Páginas del historial" className="flex gap-4">
        {pagina > 1 ? (
          <a href={enlace(pagina - 1)} className="min-h-11 underline">
            Página anterior
          </a>
        ) : null}
        {mas ? (
          <a href={enlace(pagina + 1)} className="min-h-11 underline">
            Página siguiente
          </a>
        ) : null}
      </nav>
    </section>
  );
}
