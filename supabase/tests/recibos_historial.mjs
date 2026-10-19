/** EPT-113. Auth/RLS, fuente, PDF y bytes cookies/Bearer reales. Solo fixtures locales. */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import { extractText } from "unpdf";
import {
  sql,
  rpc,
  rest,
  crearCuentaConPerfil,
  exigirSesion,
  cookieDe,
  crearServidorNext,
  limpiarFixture,
} from "./_arnes-ept59.mjs";
import {
  ID,
  PAGO,
  roles,
  economiaFixture,
  pagoFixture,
  limpiarEconomia,
} from "./_verificacion-fixture.mjs";
const dir = process.env.EPT_SUPABASE_WORKDIR;
const salida = execSync(
  `npx --yes supabase@2.117.0 status -o env${dir ? ` --workdir "${dir}"` : ""}`,
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
);
const local = Object.fromEntries(
  salida
    .split(/\r?\n/u)
    .map((l) => /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
assert.equal(new URL(local.API_URL).hostname, "127.0.0.1");
const modoUi = process.argv.includes("--ui");
const baseUi = modoUi ? process.env.EPT_RECIBOS_UI_BASE_URL : undefined;
if (baseUi) {
  const url = new URL(baseUi);
  assert.ok(["http:", "https:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.username + url.password + url.search + url.hash, "");
}
const servidor = baseUi
  ? { url: baseUi, iniciar: async () => {}, detener: async () => {} }
  : crearServidorNext(Number(process.env.EPT_PUERTO_NEXT ?? 32313));
const a = {},
  sesiones = {};
let navegador, primario;
let casos = 0;
const ok = (v, m) => {
  assert.ok(v, m);
  console.log(`OK ${++casos}: ${m}`);
};
const llamada = (actor, nombre, args) =>
  rpc(local, actor ? sesiones[actor].access_token : null, nombre, args);
const historial = (actor, alumno = a.alumno) =>
  llamada(actor, "consultar_registro_comprobantes", {
    p_alumno_id: alumno,
    p_criterio: "PERIODO_FACTURA",
    p_desde: "2027-01-01",
    p_hasta: "2027-12-31",
  });
const decision = (d = "APROBADO") =>
  llamada("director", "verificar_pago", {
    p_pago_id: PAGO,
    p_decision: d,
    p_motivo: d === "RECHAZADO" ? "Documento no válido" : null,
  });
const pdf = async (actor, id, cookie = false) =>
  fetch(`${servidor.url}/api/recibos/${id}/pdf`, {
    headers: actor
      ? cookie
        ? { cookie: cookieDe(sesiones[actor]) }
        : { Authorization: `Bearer ${sesiones[actor].access_token}` }
      : {},
    redirect: "manual",
    signal: AbortSignal.timeout(60000),
  });
try {
  for (const [i, [k, rol]] of Object.entries(roles).entries()) {
    const email = `ept113.${k}@ept.local`;
    const pass = "sintetica-ept113-segura";
    const user = await crearCuentaConPerfil(local, {
      email,
      password: pass,
      perfil: {
        nombre: "María José",
        apellido: `Muñoz EPT113 ${k}`,
        dni: `97113${String(i + 1).padStart(3, "0")}`,
        rol_id: Number(
          sql(`SELECT id FROM public.roles WHERE nombre='${rol}';`),
        ),
        legajo_nro: ["ESTUDIANTE", "DOCENTE"].includes(rol)
          ? `EPT113-${k}`
          : null,
      },
    });
    a[k] = sql(`SELECT id FROM public.perfiles WHERE user_id='${user}';`);
    sesiones[k] = await exigirSesion(local, email, pass);
  }
  sql(
    `BEGIN; ${economiaFixture(a)} ${pagoFixture(a)} UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE id='${a.bloqueado}'; COMMIT;`,
  );
  let h = await historial("padre");
  assert.equal(h.estado, 200, JSON.stringify(h));
  assert.equal(h.cuerpo[0].estado, "PENDIENTE_VERIFICACION");
  assert.equal(h.cuerpo[0].recibo_id, null);
  assert.equal(h.cuerpo[0].items.length, 2);
  ok(
    true,
    "pendiente multifactura conserva ítems seleccionados y no tiene recibo",
  );
  assert.equal(
    (await llamada("director", "recuperar_recibo", { p_pago_id: PAGO })).cuerpo
      .code,
    "P6891",
  );
  assert.equal((await decision("RECHAZADO")).estado, 200);
  h = await historial("alumno");
  assert.equal(h.cuerpo[0].estado, "RECHAZADO");
  assert.ok(h.cuerpo[0].items.every((i) => i.activa === false));
  assert.equal(h.cuerpo[0].recibo_id, null);
  ok(
    true,
    "rechazo conserva ítems históricos inactivos sin presentarlos como abonados",
  );
  sql(
    `BEGIN; DELETE FROM public.comprobantes_pago WHERE pago_id='${PAGO}';DELETE FROM public.imputaciones_pago WHERE pago_id='${PAGO}';DELETE FROM public.pagos WHERE id='${PAGO}';${pagoFixture(a)} COMMIT;`,
  );
  // Fallo transaccional inyectado exclusivamente en fixtures: no sobrevive aprobación parcial.
  sql(
    `CREATE FUNCTION app_private.ept113_falla() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla sintética'; END $$; CREATE TRIGGER ept113_falla BEFORE INSERT ON app_private.recibos_fuente FOR EACH ROW EXECUTE FUNCTION app_private.ept113_falla();`,
  );
  assert.notEqual((await decision()).estado, 200);
  assert.equal(
    sql(`SELECT estado FROM public.pagos WHERE id='${PAGO}';`),
    "PENDIENTE_VERIFICACION",
  );
  assert.equal(
    sql(`SELECT count(*) FROM public.recibos WHERE pago_id='${PAGO}';`),
    "0",
  );
  sql(
    "DROP TRIGGER ept113_falla ON app_private.recibos_fuente; DROP FUNCTION app_private.ept113_falla();",
  );
  ok(
    true,
    "fallo de fuente revierte aprobación, identidad e imputación atómicamente",
  );
  assert.equal((await decision()).estado, 200);
  const r = JSON.parse(
    sql(`SELECT row_to_json(r) FROM public.recibos r WHERE pago_id='${PAGO}';`),
  );
  const antes = sql(
    `SELECT contenido FROM app_private.recibos_fuente WHERE recibo_id='${r.id}';`,
  );
  assert.equal((await decision()).cuerpo.repetido, true);
  assert.equal(
    (await llamada("director", "recuperar_recibo", { p_pago_id: PAGO })).cuerpo,
    r.id,
  );
  assert.equal(
    sql(`SELECT count(*) FROM public.recibos WHERE pago_id='${PAGO}';`),
    "1",
  );
  ok(
    true,
    "aprobación, respuesta perdida y recuperación repiten identidad y número únicos",
  );
  // Identidad preexistente sin fuente: no borrar ni renumerar una emisión incierta.
  sql(`DELETE FROM app_private.recibos_fuente WHERE recibo_id='${r.id}';`);
  assert.equal((await historial("padre")).cuerpo[0].recibo_id, null);
  assert.equal(
    (await llamada("padre", "consultar_recibo", { p_recibo_id: r.id })).cuerpo
      .code,
    "P6892",
  );
  assert.equal(
    (await llamada("director", "recuperar_recibo", { p_pago_id: PAGO })).cuerpo
      .code,
    "P6892",
  );
  assert.equal(
    sql(`SELECT id FROM public.recibos WHERE pago_id='${PAGO}';`),
    r.id,
  );
  sql(
    `INSERT INTO app_private.recibos_fuente(recibo_id,contenido)VALUES('${r.id}','${antes.replaceAll("'", "''")}'::JSONB);`,
  );
  ok(
    true,
    "identidad existente sin fuente queda por conciliar, sin nueva numeración ni enlace descargable",
  );
  const verificado = sql(
    `SELECT verificado_en::TEXT FROM public.pagos WHERE id='${PAGO}';`,
  );
  sql(`DELETE FROM public.recibos WHERE id='${r.id}';`); // Simula aprobado anterior a EPT-113, SOLO fixture descartable.
  assert.equal((await decision()).cuerpo.repetido, true);
  const recibo = sql(`SELECT id FROM public.recibos WHERE pago_id='${PAGO}';`);
  assert.equal(
    sql(`SELECT verificado_en::TEXT FROM public.pagos WHERE id='${PAGO}';`),
    verificado,
  );
  ok(
    true,
    "rama de repetición recupera aprobado antiguo sin reaprobar ni falsificar fechas",
  );
  const canonic = sql(
    `SELECT contenido FROM app_private.recibos_fuente WHERE recibo_id='${recibo}';`,
  );
  sql(
    `UPDATE public.perfiles SET nombre='Nombre posterior' WHERE id='${a.alumno}'; UPDATE public.tarifas SET importe=777 WHERE id='${ID(401)}';`,
  );
  assert.equal(
    sql(
      `SELECT contenido FROM app_private.recibos_fuente WHERE recibo_id='${recibo}';`,
    ),
    canonic,
  );
  sql(`UPDATE public.tarifas SET importe=500 WHERE id='${ID(401)}';`);
  ok(
    true,
    "nombres y catálogos posteriores no alteran el contenido canónico ya emitido",
  );
  assert.ok(
    antes.includes("990.00") &&
      antes.includes("1000.00") &&
      antes.includes("-10.00"),
  );
  for (const actor of ["padre", "copadre", "alumno", "director"]) {
    const x = await llamada(actor, "consultar_recibo", { p_recibo_id: recibo });
    assert.equal(x.estado, 200);
    assert.equal(x.cuerpo.recibo_id, recibo);
    const hist = await historial(actor);
    assert.equal(hist.estado, 200);
    assert.equal(hist.cuerpo[0].recibo_id, recibo);
    ok(
      true,
      `${actor}: RPC/historial autorizados con vínculo/identidad vigente`,
    );
  }
  for (const actor of [
    "otraFamilia",
    "ajeno",
    "docente",
    "personal",
    "bloqueado",
    null,
  ]) {
    const x = await llamada(actor, "consultar_recibo", { p_recibo_id: recibo });
    assert.ok([401, 403].includes(x.estado), `${actor} ${JSON.stringify(x)}`);
    const hist = await historial(actor);
    assert.ok(
      actor === null
        ? [401, 403].includes(hist.estado)
        : hist.estado === 200 && hist.cuerpo.length === 0,
    );
    ok(true, `${actor ?? "anónimo"}: fuente e historial ajenos denegados`);
  }
  assert.deepEqual((await historial("alumno", a.ajeno)).cuerpo, []);
  for (const actor of ["copadre", "alumno"])
    assert.deepEqual(
      (
        await rest(
          local,
          sesiones[actor].access_token,
          `comprobantes_pago?select=id&pago_id=eq.${PAGO}`,
        )
      ).cuerpo,
      [],
    );
  assert.ok(
    [401, 403].includes(
      (
        await rest(
          local,
          sesiones.padre.access_token,
          "recibos?select=archivo_path",
        )
      ).estado,
    ),
  );
  ok(true, "recibo no amplía el permiso del original ni expone archivo_path");
  try {
    await servidor.iniciar({
      NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    });
  } catch (error) {
    // Solo categorías conocidas: no publicar rutas, variables ni datos de peticiones.
    const registro = servidor.registro ?? "";
    const diagnostico = [
      "Unable to acquire lock",
      "EADDRINUSE",
      "EACCES",
    ].filter((codigo) => registro.includes(codigo));
    console.error(
      "Inicio Next EPT113:",
      diagnostico.length ? diagnostico.join(", ") : "sin categoría pública",
    );
    throw error;
  }
  for (const actor of ["padre", "copadre", "alumno", "director"])
    for (const cookie of [false, true]) {
      const res = await pdf(actor, recibo, cookie);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/pdf");
      assert.match(res.headers.get("cache-control"), /no-store/u);
      assert.equal(res.headers.get("location"), null);
      const bytes = new Uint8Array(await res.arrayBuffer());
      assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
      const text = (await extractText(bytes, { mergePages: true })).text;
      assert.match(text, /María José/u);
      assert.match(text, /ARS 1.000,00/u);
      assert.match(text, /ARS 990,00/u);
      assert.match(text, /ARS -10,00/u);
      assert.doesNotMatch(text, /ruta_archivo|97113|ept113\..*@|OP-EPT111/u);
      ok(
        true,
        `${actor}: bytes PDF válidos ${cookie ? "cookies web" : "Bearer móvil"}, sin redirección`,
      );
    }
  for (const actor of [
    "otraFamilia",
    "ajeno",
    "docente",
    "personal",
    "bloqueado",
    null,
  ])
    assert.equal((await pdf(actor, recibo)).status, actor === null ? 401 : 403);
  assert.equal((await pdf("padre", "no-es-uuid")).status, 400);
  assert.equal((await pdf("padre", ID(9999))).status, 403);
  ok(
    true,
    "API distingue sesión, permiso e ID manipulado sin filtrar existencia",
  );
  // Render falla después del commit; recupera sin otro número ni aprobación.
  sql(
    `UPDATE app_private.recibos_fuente SET contenido=contenido || '{"items":[]}'::JSONB WHERE recibo_id='${recibo}';`,
  );
  assert.equal((await pdf("padre", recibo)).status, 503);
  assert.equal(
    sql(`SELECT estado FROM public.pagos WHERE id='${PAGO}';`),
    "APROBADO",
  );
  sql(
    `UPDATE app_private.recibos_fuente SET contenido='${canonic.replaceAll("'", "''")}'::JSONB WHERE recibo_id='${recibo}';`,
  );
  const paralelas = await Promise.all([
    pdf("padre", recibo),
    pdf("copadre", recibo),
  ]);
  assert.ok(paralelas.every((x) => x.status === 200));
  assert.equal(
    sql(`SELECT id FROM public.recibos WHERE pago_id='${PAGO}';`),
    recibo,
  );
  ok(
    true,
    "render fallido, reintento y dos renderers conservan identidad y aprobación",
  );
  sql(
    `DELETE FROM public.padres_hijos WHERE padre_id='${a.copadre}' AND hijo_id='${a.alumno}';`,
  );
  assert.equal((await pdf("copadre", recibo)).status, 403);
  assert.deepEqual((await historial("copadre")).cuerpo, []);
  sql(
    `UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE id='${a.padre}';`,
  );
  assert.equal((await pdf("padre", recibo)).status, 403);
  sql(
    `UPDATE public.perfiles SET estado_acceso='HABILITADO' WHERE id='${a.padre}';UPDATE public.perfiles SET rol_id=(SELECT id FROM public.roles WHERE nombre='PERSONAL') WHERE id='${a.segundo}';`,
  );
  assert.equal((await pdf("segundo", recibo)).status, 403);
  ok(
    true,
    "vínculo revocado, cuenta bloqueada y rol perdido cortan bytes con JWT todavía vigente",
  );
  // Web real y descarga nativa del navegador: no basta una ruta API aislada.
  if (modoUi) {
    navegador = await chromium.launch({ headless: true });
    const host = servidor.url.replace("127.0.0.1", "localhost");
    const ctx = await navegador.newContext();
    const cookie = cookieDe(sesiones.padre);
    await ctx.addCookies([
      {
        name: cookie.slice(0, cookie.indexOf("=")),
        value: cookie.slice(cookie.indexOf("=") + 1),
        url: host,
      },
    ]);
    const page = await ctx.newPage();
    await page.goto(
      `${host}/dashboard/hijos?desde=2027-01-01&hasta=2027-12-31`,
    );
    await page
      .getByRole("heading", { name: "Historial de pagos y recibos" })
      .waitFor()
      .catch(async () => {
        throw new Error(
          `Historial web: ${(await page.locator("body").innerText()).slice(-1800)}; ${servidor.registro.slice(-1800)}`,
        );
      });
    const descarga = page.waitForEvent("download");
    await page.getByRole("button", { name: "Descargar recibo PDF" }).click();
    assert.match((await descarga).suggestedFilename(), /^recibo-.*\.pdf$/u);
    sql(
      `INSERT INTO public.padres_hijos(padre_id,hijo_id)VALUES('${a.padre}','${a.ajeno}');`,
    );
    await page.reload();
    await page
      .locator('select[name="hijo"]')
      .selectOption(a.ajeno)
      .catch(async () => {
        throw new Error(
          `Selector de hijo: ${(await page.locator("body").innerText()).slice(-2200)}`,
        );
      });
    await page.getByRole("button", { name: "Consultar historial" }).click();
    await page
      .getByText("No hay pagos para el estudiante y rango seleccionados.")
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Descargar recibo PDF" }).count(),
      0,
    );
    await ctx.close();
    ok(true, "web familiar descarga y cambio de hijo descarta recibo anterior");
    const estudiante = await navegador.newContext();
    const ce = cookieDe(sesiones.alumno);
    await estudiante.addCookies([
      {
        name: ce.slice(0, ce.indexOf("=")),
        value: ce.slice(ce.indexOf("=") + 1),
        url: host,
      },
    ]);
    const pe = await estudiante.newPage();
    await pe.goto(
      `${host}/dashboard/mi-legajo?desde=2027-01-01&hasta=2027-12-31&hijo=${a.ajeno}`,
    );
    await pe
      .getByRole("heading", { name: "Historial de pagos y recibos" })
      .waitFor();
    assert.equal(await pe.locator('select[name="hijo"]').count(), 0);
    assert.equal(await pe.getByRole("checkbox").count(), 0);
    await pe.getByRole("button", { name: "Descargar recibo PDF" }).waitFor();
    await estudiante.close();
    ok(
      true,
      "web estudiante ignora alumno manipulado, muestra propio y no ofrece selección ni carga",
    );
  }
  // Historial >1000: se recorren páginas reales de PostgREST, sin omitir registros posteriores al límite.
  sql(
    `INSERT INTO public.pagos(id,padre_id,alumno_id,total_calculado,fecha_transferencia) SELECT ('b1131000-0000-4000-8000-'||lpad(n::TEXT,12,'0'))::UUID,'${a.padre}','${a.alumno}',1,'2027-06-01' FROM generate_series(1,1005)n;`,
  );
  const ids = [];
  for (let desde = 0; ; desde += 200) {
    const x = await rest(
      local,
      sesiones.padre.access_token,
      `rpc/consultar_registro_comprobantes?offset=${desde}&limit=200`,
      {
        method: "POST",
        body: {
          p_alumno_id: a.alumno,
          p_criterio: "FECHA_TRANSFERENCIA",
          p_desde: "2026-01-01",
          p_hasta: "2027-12-31",
        },
      },
    );
    assert.equal(x.estado, 200);
    ids.push(...x.cuerpo.map((p) => p.pago_id));
    if (x.cuerpo.length < 200) break;
  }
  assert.equal(ids.length, 1006);
  assert.equal(new Set(ids).size, 1006);
  ok(
    true,
    "1006 pagos recorren límites PostgREST con paginación y sin duplicados",
  );
} catch (e) {
  primario = e;
} finally {
  const errores = [];
  for (const limpiar of [
    () => navegador?.close(),
    () => servidor.detener(),
    () =>
      sql(
        "DROP TRIGGER IF EXISTS ept113_falla ON app_private.recibos_fuente; DROP FUNCTION IF EXISTS app_private.ept113_falla();",
      ),
    () => {
      if (a.alumno && a.ajeno) sql(`BEGIN;${limpiarEconomia(a)}COMMIT;`);
    },
    () =>
      limpiarFixture({
        prefijoDni: "97113",
        prefijoCorreo: "ept113.",
        dominio: "ept.local",
        curso: "Curso EPT111",
      }),
  ]) {
    try {
      await limpiar();
    } catch (e) {
      errores.push(e);
    }
  }
  if (primario || errores.length)
    throw new AggregateError(
      [primario, ...errores].filter(Boolean),
      "EPT-113 incompleto; errores originales conservados",
    );
}
console.log(`${casos} comprobaciones reales EPT-113 completadas.`);
