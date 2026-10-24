import assert from "node:assert/strict";
import { SesionPsql, esperarBloqueo } from "./_sesion-psql.mjs";
import {
  actoresFijos as A,
  ID,
  PAGO,
  perfilesFixture,
  economiaFixture,
  pagoFixture,
  limpiarEconomia,
} from "./_verificacion-fixture.mjs";
const sesiones = Object.fromEntries(
  ["a", "b", "c"].map((k) => [k, new SesionPsql(k, "EPT113")]),
);
const { a, b, c } = sesiones;
const pids = {};
let casos = 0;
const pendientes = [];
const como = (id) =>
  `RESET ROLE;SET ROLE authenticated;SELECT set_config('request.jwt.claims','${JSON.stringify({ sub: id, role: "authenticated" })}',false);`;
const captura = (q) =>
  `DO $$ BEGIN BEGIN PERFORM set_config('ept113.res',(${q})::TEXT,false); EXCEPTION WHEN OTHERS THEN PERFORM set_config('ept113.res',SQLSTATE,false);END;END $$;`;
const res = (s) => s.escalar("current_setting('ept113.res',true)", "res");
const correr = (s, q) => {
  const p = s.ejecutar(captura(q), "competidor");
  p.catch(() => {});
  pendientes.push(p);
  return p;
};
const recuperar = `SELECT public.recuperar_recibo('${PAGO}')`;
let recibo;
async function caso(nombre, f) {
  await f();
  console.log(`OK ${++casos}: ${nombre}`);
}
try {
  for (const [k, s] of Object.entries(sesiones))
    pids[k] = Number(await s.escalar("pg_backend_pid()", "pid"));
  await c.ejecutar(
    `BEGIN;${perfilesFixture()}${economiaFixture()}${pagoFixture()}COMMIT;`,
    "fixtures",
  );
  await a.ejecutar(como(A.director), "director");
  await a.ejecutar(
    `SELECT public.verificar_pago('${PAGO}','APROBADO',NULL);`,
    "aprobar",
  );
  // SOLO fixture descartable: representar una aprobación anterior a esta migración.
  await c.ejecutar(
    `DELETE FROM public.recibos WHERE pago_id='${PAGO}';`,
    "anterior",
  );
  await b.ejecutar(como(A.segundo), "director2");
  await caso(
    "dos emisiones del aprobado antiguo esperan sobre el mismo pago y comparten identidad",
    async () => {
      await a.ejecutar(`BEGIN;${captura(recuperar)}`, "emision1");
      recibo = await res(a);
      await b.ejecutar("BEGIN;", "begin2");
      const p = correr(b, recuperar);
      await esperarBloqueo(c, pids.a, pids.b);
      await a.ejecutar("COMMIT;", "commit1");
      await p;
      assert.equal(await res(b), recibo);
      await b.ejecutar("COMMIT;", "commit2");
      assert.equal(
        await c.escalar(
          `(SELECT count(*) FROM public.recibos WHERE pago_id='${PAGO}')`,
          "unico",
        ),
        "1",
      );
    },
  );
  await caso(
    "repetición tras respuesta perdida conserva número, instante y fuente",
    async () => {
      const antes = await c.escalar(
        `(SELECT md5(row_to_json(x)::TEXT) FROM (SELECT r.numero,r.emitido_en,f.contenido FROM public.recibos r JOIN app_private.recibos_fuente f ON f.recibo_id=r.id WHERE r.id='${recibo}')x)`,
        "fuente1",
      );
      await a.ejecutar(captura(recuperar), "repetir");
      assert.equal(await res(a), recibo);
      const despues = await c.escalar(
        `(SELECT md5(row_to_json(x)::TEXT) FROM (SELECT r.numero,r.emitido_en,f.contenido FROM public.recibos r JOIN app_private.recibos_fuente f ON f.recibo_id=r.id WHERE r.id='${recibo}')x)`,
        "fuente2",
      );
      assert.equal(antes, despues);
    },
  );
  for (const cambio of [
    "estado_acceso='BLOQUEADO'",
    "rol_id=(SELECT id FROM public.roles WHERE nombre='PERSONAL')",
  ]) {
    await caso(
      `revocación de actor primero (${cambio.split("=")[0]}) impide emitir después de espera observada`,
      async () => {
        await c.ejecutar(
          `BEGIN;UPDATE public.perfiles SET ${cambio} WHERE id='${A.director}';`,
          "revocar",
        );
        const p = correr(a, recuperar);
        await esperarBloqueo(b, pids.c, pids.a);
        await c.ejecutar("COMMIT;", "revocar_commit");
        await p;
        assert.equal(await res(a), "42501");
        await c.ejecutar(
          `UPDATE public.perfiles SET estado_acceso='HABILITADO',rol_id=(SELECT id FROM public.roles WHERE nombre='DIRECTOR') WHERE id='${A.director}';`,
          "restaurar",
        );
      },
    );
  }
  await a.ejecutar(como(A.padre), "padre");
  const lectura = `SELECT public.consultar_recibo('${recibo}')`;
  await caso(
    "lectura primero mantiene vínculo hasta fin transaccional; borrado espera sin ciclo",
    async () => {
      await a.ejecutar(`BEGIN;${captura(lectura)}`, "leer");
      const p = b.ejecutar(
        `RESET ROLE;DELETE FROM public.padres_hijos WHERE padre_id='${A.padre}' AND hijo_id='${A.alumno}';`,
        "borrar_vinculo",
      );
      p.catch(() => {});
      pendientes.push(p);
      await esperarBloqueo(c, pids.a, pids.b);
      await a.ejecutar("COMMIT;", "fin_lectura");
      await p;
      await a.ejecutar(captura(lectura), "ya_no");
      assert.equal(await res(a), "42501");
    },
  );
  await c.ejecutar(
    `INSERT INTO public.padres_hijos(padre_id,hijo_id)VALUES('${A.padre}','${A.alumno}');`,
    "vinculo",
  );
  await caso(
    "revocar vínculo primero hace esperar lectura y luego deniega",
    async () => {
      await c.ejecutar(
        `BEGIN;DELETE FROM public.padres_hijos WHERE padre_id='${A.padre}' AND hijo_id='${A.alumno}';`,
        "borrar",
      );
      const p = correr(a, lectura);
      await esperarBloqueo(b, pids.c, pids.a);
      await c.ejecutar("COMMIT;", "fin");
      await p;
      assert.equal(await res(a), "42501");
    },
  );
  await caso(
    "bloquear cuenta primero deniega lectura con JWT anterior después de espera",
    async () => {
      await c.ejecutar(
        `BEGIN;UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE id='${A.padre}';`,
        "bloquear",
      );
      const p = correr(a, lectura);
      await esperarBloqueo(b, pids.c, pids.a);
      await c.ejecutar("COMMIT;", "fin");
      await p;
      assert.equal(await res(a), "42501");
    },
  );
  await caso(
    "pagos distintos en paralelo obtienen números distintos sin max+1 ni espera mutua",
    async () => {
      const segundo = ID(62),
        item = ID(8012);
      await c.ejecutar(
        `BEGIN;INSERT INTO public.pagos(id,padre_id,alumno_id,total_calculado,importe_informado,fecha_transferencia,numero_operacion,estado,verificado_por,verificado_en)VALUES('${segundo}','${A.padre}','${A.alumno}',300,300,'2026-10-17','OP-EPT113-2','APROBADO','${A.director}',clock_timestamp());INSERT INTO public.imputaciones_pago(pago_id,item_factura_id,alumno_id,importe)VALUES('${segundo}','${item}','${A.alumno}',300);UPDATE public.items_factura SET estado_pago='PAGADO' WHERE id='${item}';DELETE FROM public.recibos WHERE pago_id='${PAGO}';COMMIT;`,
        "otro_pago",
      );
      await a.ejecutar(como(A.director), "director");
      await b.ejecutar(como(A.segundo), "director2");
      await a.ejecutar(`BEGIN;${captura(recuperar)}`, "uno");
      await b.ejecutar(
        `BEGIN;${captura(`SELECT public.recuperar_recibo('${segundo}')`)}`,
        "dos",
      );
      assert.notEqual(await res(a), await res(b));
      await Promise.all([
        a.ejecutar("COMMIT;", "fin1"),
        b.ejecutar("COMMIT;", "fin2"),
      ]);
      assert.equal(
        await c.escalar(
          `(SELECT count(DISTINCT numero) FROM public.recibos WHERE pago_id IN('${PAGO}','${segundo}'))`,
          "numeros",
        ),
        "2",
      );
    },
  );
} finally {
  await Promise.allSettled(
    [a, b, c].map((s) => s.ejecutar("ROLLBACK;RESET ROLE;", "rollback")),
  );
  await Promise.allSettled(pendientes);
  await c
    .ejecutar(
      `BEGIN;${limpiarEconomia()}
 ALTER TABLE public.perfiles_historial DISABLE TRIGGER impedir_modificar_historial_perfiles;
 DELETE FROM public.perfiles_historial WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '98111%') OR actor_perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '98111%');
 ALTER TABLE public.perfiles_historial ENABLE TRIGGER impedir_modificar_historial_perfiles;
 DELETE FROM public.alumnos WHERE perfil_id IN('${A.alumno}','${A.ajeno}');
 DELETE FROM public.profesores WHERE perfil_id='${A.docente}';
 DELETE FROM public.perfiles WHERE id IN('${Object.values(A).join("','")}');COMMIT;`,
      "limpiar",
    )
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
  await Promise.all(Object.values(sesiones).map((s) => s.cerrar()));
}
console.log(
  `${casos} escenarios reales EPT-113, esperas observadas mediante pg_blocking_pids.`,
);
