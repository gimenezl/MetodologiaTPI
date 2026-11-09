-- EPT-124: datos de PRUEBA (ficticios) de tarifas y feriados. Importes en ARS.
BEGIN;
INSERT INTO public.tarifas (concepto, nivel_id, importe, desde) VALUES
  ('CUOTA', 1, 100000.00, '2026-11-01'),
  ('CUOTA', 2, 120000.00, '2026-11-01'),
  ('CUOTA', 3, 140000.00, '2026-11-01'),
  ('CUOTA', 7, 160000.00, '2026-11-01');
INSERT INTO public.tarifas (concepto, deporte_id, importe, desde)
  SELECT 'DEPORTE', id, 15000.00, DATE '2026-11-01' FROM public.deportes;
INSERT INTO public.tarifas (concepto, servicio_id, importe, desde)
  SELECT tipo::text::public.concepto_economico, id,
         CASE nombre WHEN 'Recorrido Norte (ficticio)' THEN 20000.00 WHEN 'Recorrido Sur (ficticio)' THEN 22000.00
                     WHEN 'Recorrido Este (ficticio)' THEN 24000.00 WHEN 'Recorrido Oeste (ficticio)' THEN 26000.00
                     ELSE 30000.00 END, DATE '2026-11-01'
  FROM public.servicios_escolares;
INSERT INTO public.feriados (fecha, descripcion) VALUES
  ('2026-11-20', 'Día de la Soberanía Nacional (dato de prueba)'),
  ('2026-12-08', 'Inmaculada Concepción de María (dato de prueba)'),
  ('2026-12-25', 'Navidad (dato de prueba)');
COMMIT;
