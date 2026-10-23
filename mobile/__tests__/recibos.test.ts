import {
  compartirRecibo,
  compartirPdfPrivado,
  leerPdfRespuesta,
  limpiarRecibosTemporales,
} from "@/servicios/recibos";
import { fetch as fetchNativo } from "expo/fetch";
import * as Sharing from "expo-sharing";
import type { ClienteEPT } from "@/servicios/supabase";

const mockEscribir = jest.fn(),
  mockBorrar = jest.fn(),
  mockCrear = jest.fn();
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));
jest.mock("@/configuracion/entorno", () => ({
  entornoDelBundle: () => ({
    ok: true,
    entorno: { apiBaseUrl: "https://api.example.org" },
  }),
}));
jest.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  Directory: class {
    exists = true;
    delete() {
      mockBorrar();
    }
    create() {
      mockCrear();
    }
  },
  File: class {
    uri = "file:///cache/recibo.pdf";
    create() {
      mockCrear();
    }
    write(b: Uint8Array) {
      mockEscribir(b);
    }
  },
}));
const id = "b1130000-0000-4000-8000-000000000001";
const pdf = Uint8Array.from(
  ("%PDF-1.7\n" + "a".repeat(180) + "\n%%EOF")
    .split("")
    .map((c) => c.charCodeAt(0)),
);
function respuesta(
  bytes = pdf,
  {
    estado = 200,
    mime = "application/pdf",
    declarado = String(bytes.length),
    redirected = false,
  } = {},
): Response {
  let leido = false;
  return {
    ok: estado === 200,
    status: estado,
    redirected,
    headers: {
      get: (k: string) =>
        k === "content-type" ? mime : k === "content-length" ? declarado : null,
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (leido) return { done: true };
          leido = true;
          return { done: false, value: bytes };
        },
        cancel: async () => {},
        releaseLock: () => {},
      }),
    },
  } as unknown as Response;
}
const cliente = (
  sesiones: { token: string; usuario: string }[] = [
    { token: "token", usuario: "u1" },
  ],
) =>
  ({
    auth: {
      getSession: jest.fn(async () => {
        const s = sesiones.length > 1 ? sesiones.shift()! : sesiones[0];
        return {
          data: { session: { access_token: s.token, user: { id: s.usuario } } },
          error: null,
        };
      }),
    },
  }) as unknown as ClienteEPT;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchNativo).mockResolvedValue(respuesta() as never);
  jest.mocked(Sharing.shareAsync).mockResolvedValue();
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
});
test("valida bytes PDF completos y notifica progreso antes de guardar", async () => {
  const progreso = jest.fn();
  expect(
    await leerPdfRespuesta(respuesta(), new AbortController().signal, progreso),
  ).toEqual(pdf);
  expect(progreso).toHaveBeenCalledWith(pdf.length);
});
test.each([
  respuesta(pdf, { estado: 401 }),
  respuesta(pdf, { estado: 403 }),
  respuesta(pdf, { estado: 503 }),
  respuesta(pdf, { mime: "text/html" }),
  respuesta(pdf, { redirected: true }),
  respuesta(pdf, { declarado: "999999999" }),
  respuesta(pdf, { declarado: "1" }),
  respuesta(
    Uint8Array.from(
      "x"
        .repeat(200)
        .split("")
        .map((c) => c.charCodeAt(0)),
    ),
  ),
])("rechaza errores, redirects, MIME, tamaño, HTML y truncados", async (r) => {
  await expect(
    leerPdfRespuesta(r, new AbortController().signal, () => {}),
  ).rejects.toThrow();
  expect(mockEscribir).not.toHaveBeenCalled();
});
test("usa expo/fetch con rechazo nativo de redirects, sin cookies; comparte y limpia", async () => {
  await compartirRecibo(cliente(), id, new AbortController().signal, () => {});
  expect(fetchNativo).toHaveBeenCalledWith(
    `https://api.example.org/api/recibos/${id}/pdf`,
    expect.objectContaining({
      redirect: "error",
      credentials: "omit",
      headers: { Authorization: "Bearer token" },
    }),
  );
  expect(mockEscribir).toHaveBeenCalledWith(pdf);
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    "file:///cache/recibo.pdf",
    expect.objectContaining({ mimeType: "application/pdf" }),
  );
  expect(mockBorrar).toHaveBeenCalledTimes(2);
});
test("cambio de cuenta o logout antes de compartir descarta bytes", async () => {
  await expect(
    compartirRecibo(
      cliente([
        { token: "token", usuario: "u1" },
        { token: "token-b", usuario: "u2" },
      ]),
      id,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow("sesión cambió");
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(mockEscribir).not.toHaveBeenCalled();
});
test("la renovación del token de la misma cuenta durante la descarga no la invalida", async () => {
  await compartirRecibo(
    cliente([
      { token: "token", usuario: "u1" },
      { token: "token-renovado", usuario: "u1" },
    ]),
    id,
    new AbortController().signal,
    () => {},
  );
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
});
test("logout durante la descarga descarta los bytes", async () => {
  const c = cliente();
  jest
    .mocked(c.auth.getSession)
    .mockResolvedValueOnce({
      data: { session: { access_token: "t", user: { id: "u1" } } },
      error: null,
    } as never)
    .mockResolvedValueOnce({ data: { session: null }, error: null } as never);
  await expect(
    compartirRecibo(c, id, new AbortController().signal, () => {}),
  ).rejects.toThrow("sesión cambió");
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
test("cancelación no abre el menú ni conserva el archivo", async () => {
  const c = new AbortController();
  c.abort();
  await expect(
    compartirRecibo(cliente(), id, c.signal, () => {}),
  ).rejects.toThrow();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
test("doble pulsación no inicia otra descarga; fallo nativo limpia el temporal", async () => {
  let resolver!: () => void;
  jest.mocked(Sharing.shareAsync).mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolver = r;
      }),
  );
  const uno = compartirRecibo(
    cliente(),
    id,
    new AbortController().signal,
    () => {},
  );
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await expect(
    compartirRecibo(cliente(), id, new AbortController().signal, () => {}),
  ).rejects.toThrow("en curso");
  resolver();
  await uno;
  jest
    .mocked(Sharing.shareAsync)
    .mockRejectedValueOnce(new Error("fallo nativo"));
  await expect(
    compartirPdfPrivado(pdf, id, new AbortController().signal),
  ).rejects.toThrow("fallo nativo");
  expect(mockBorrar).toHaveBeenCalledTimes(4);
});
test("limpia restos privados al iniciar, sin directorios ajenos", () => {
  limpiarRecibosTemporales();
  expect(mockBorrar).toHaveBeenCalledTimes(1);
});
test("fallo de red no escribe ni abre recursos externos", async () => {
  jest.mocked(fetchNativo).mockRejectedValueOnce(new Error("red"));
  await expect(
    compartirRecibo(cliente(), id, new AbortController().signal, () => {}),
  ).rejects.toThrow("red");
  expect(mockEscribir).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

test("notifica fin de descarga antes de abrir el menú nativo", async () => {
  const preparada = jest.fn();
  jest.mocked(Sharing.shareAsync).mockImplementationOnce(async () => {
    expect(preparada).toHaveBeenCalledTimes(1);
  });
  await compartirRecibo(
    cliente(),
    id,
    new AbortController().signal,
    () => {},
    preparada,
  );
});
