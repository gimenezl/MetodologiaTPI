import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { DescargaRecibo } from "@/contenedores/consultas/DescargaRecibo";
import { compartirRecibo } from "@/servicios/recibos";
import type { ClienteEPT } from "@/servicios/supabase";

jest.mock("@/servicios/recibos", () => ({ compartirRecibo: jest.fn() }));

const cliente = {} as ClienteEPT;
const pendientes: {
  senal: AbortSignal;
  preparar: () => void;
  resolver: () => void;
  progreso: (bytes: number) => void;
}[] = [];
beforeEach(() => {
  jest.useFakeTimers();
  pendientes.length = 0;
  jest
    .mocked(compartirRecibo)
    .mockImplementation(
      (_cliente, _id, senal, progreso, preparar) =>
        new Promise<void>((resolver) =>
          pendientes.push({ senal, progreso, preparar: preparar!, resolver }),
        ),
    );
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});
const ocupado = () =>
  screen.getByTestId("recibo-descargar").props.accessibilityState.busy;

test("el menú nativo puede cerrar con éxito después de 60 segundos sin bloquear el botón", async () => {
  await render(<DescargaRecibo cliente={cliente} reciboId="uno" />);
  await fireEvent.press(screen.getByTestId("recibo-descargar"));
  await act(async () => pendientes[0]!.preparar());
  await act(async () => {
    jest.advanceTimersByTime(61000);
  });
  expect(pendientes[0]!.senal.aborted).toBe(false);
  expect(ocupado()).toBe(true);
  await act(async () => pendientes[0]!.resolver());
  expect(ocupado()).toBe(false);
  expect(
    screen.getByText("Menú de descarga cerrado. Temporal eliminado."),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId("recibo-descargar"));
  expect(pendientes).toHaveLength(2);
});

test("cancelación y resolución tardía siempre finalizan el intento vigente", async () => {
  await render(<DescargaRecibo cliente={cliente} reciboId="uno" />);
  await fireEvent.press(screen.getByTestId("recibo-descargar"));
  await fireEvent.press(screen.getByText("Cancelar descarga"));
  expect(pendientes[0]!.senal.aborted).toBe(true);
  await act(async () => pendientes[0]!.resolver());
  expect(ocupado()).toBe(false);
  expect(
    screen.queryByText("Menú de descarga cerrado. Temporal eliminado."),
  ).toBeNull();
});

test("timeout de red aún aborta y una resolución posterior libera el botón", async () => {
  await render(<DescargaRecibo cliente={cliente} reciboId="uno" />);
  await fireEvent.press(screen.getByTestId("recibo-descargar"));
  await act(async () => {
    jest.advanceTimersByTime(60000);
  });
  expect(pendientes[0]!.senal.aborted).toBe(true);
  await act(async () => pendientes[0]!.resolver());
  expect(ocupado()).toBe(false);
});

test("cambio de contexto ignora progreso y éxito del intento anterior", async () => {
  const vista = await render(
    <DescargaRecibo cliente={cliente} reciboId="uno" />,
  );
  await fireEvent.press(screen.getByTestId("recibo-descargar"));
  await vista.rerender(<DescargaRecibo cliente={cliente} reciboId="dos" />);
  expect(pendientes[0]!.senal.aborted).toBe(true);
  expect(ocupado()).toBe(false);
  await fireEvent.press(screen.getByTestId("recibo-descargar"));
  await act(async () => {
    pendientes[0]!.progreso(99);
    pendientes[0]!.resolver();
  });
  expect(ocupado()).toBe(true);
  expect(screen.getByText("Recibidos 0 bytes")).toBeTruthy();
  expect(
    screen.queryByText("Menú de descarga cerrado. Temporal eliminado."),
  ).toBeNull();
  await act(async () => pendientes[1]!.resolver());
  expect(ocupado()).toBe(false);
});
