import type { NextConfig } from "next";

/**
 * Los bancos de prueba de interfaz no llegan al binario de producción.
 *
 * Antes bastaba con que la página llamara a `notFound()` cuando
 * `NODE_ENV === 'production'`. Eso devuelve 404, pero la ruta sigue existiendo
 * para el enrutador: su respuesta es distinta de la de una ruta inventada, así
 * que cualquiera puede averiguar que `/pruebas-ui/alumnos` está ahí. Un 404 que
 * confirma la existencia de lo que niega no es un 404.
 *
 * Los tres bancos se llaman `page.banco.tsx`. Esta extensión sólo se reconoce
 * como página fuera de producción, de modo que `next build` ni siquiera los
 * compila. La guarda en tiempo de ejecución se conserva igual: si alguien
 * cambia esta configuración, la página sigue negándose a renderizar.
 *
 * `supabase/tests/harness_produccion.mjs` lo comprueba sobre la aplicación
 * compilada, comparando la respuesta con la de una ruta que nunca existió.
 */
const extensionesDePagina = ["tsx", "ts", "jsx", "js"];

/**
 * Durante una corrida automatizada no se dibuja el indicador de desarrollo.
 *
 * Es un botón flotante que Next superpone a la página. En una captura de
 * evidencia aparece encima de la interfaz y sugiere que lo que se está viendo
 * es un entorno de desarrollo cuando la evidencia habla del comportamiento del
 * producto; además se interpone en la esquina inferior izquierda, donde puede
 * quedar por encima de un control real. Fuera de las pruebas sigue disponible.
 */
const enPruebas = process.env.EPT_UI_HARNESS === "1";

const nextConfig: NextConfig = {
  ...(enPruebas ? { devIndicators: false as const } : {}),
  pageExtensions:
    process.env.NODE_ENV === "production"
      ? extensionesDePagina
      : ["banco.tsx", ...extensionesDePagina],
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
};

export default nextConfig;
