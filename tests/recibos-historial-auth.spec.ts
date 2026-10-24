import { test } from "@playwright/test";
import { execFileSync } from "node:child_process";
test.skip(
  process.env.EPT_SUPABASE_LOCAL !== "1",
  "Requiere backend local descartable con actores reales",
);
test.describe("DIRECTOR autenticado: historial y recibos", () => {
  test("aprobación, historial familiar y descarga web real del recibo", ({
    baseURL,
  }) => {
    test.setTimeout(120000);
    execFileSync(
      process.execPath,
      ["supabase/tests/recibos_historial.mjs", "--ui"],
      {
        env: { ...process.env, EPT_RECIBOS_UI_BASE_URL: baseURL },
        encoding: "utf8",
        timeout: 110000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  });
});
