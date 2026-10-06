# Contrato de evaluaciones y notas (Fase 7)

## Estado y alcance

Contrato funcional/técnico aprobado antes de comenzar la implementación de
Fase 7. Este documento no acredita que existan tablas, migraciones, casos de uso,
autorización, interfaz o pruebas de evaluación. El progreso de implementación se
registra en [`PLAN.md`](PLAN.md).

Fase 7 configura componentes de evaluación por curso, registra notas y calcula
un resultado académico final. No incluye cierre/reapertura de curso, planilla
oficial ni otros procesos de Fase 8; tampoco elegibilidad o emisión de
certificados de Fase 9.

## Esquema de evaluación

- Cada curso tiene componentes con nombre libre y peso decimal. Los pesos deben
  sumar exactamente 100 %, sin tolerancia ni comparación de punto flotante.
- La modalidad global se deriva de los tipos de sus componentes: `THEORY`,
  `PRACTICAL` o mixta. El nombre del componente no queda restringido a un
  catálogo cerrado.
- Una vez persistida la primera nota de cualquier participante en el curso,
  incluidos valores `0`, se congelan sus componentes y pesos. No se permite
  editar el esquema después de ese momento en este alcance. Una futura política
  para editar pesos no está aprobada.
- Las notas por componente son decimales con hasta dos posiciones y rango
  inclusivo 0–100. Las notas y resultados no se calculan usando `float`;
  sumas, productos y validaciones utilizan aritmética decimal exacta.

## Cálculo y resultado

Para una evaluación completa, la nota final es `Σ(nota × peso ÷ 100)`. Solo el
resultado final se redondea a dos decimales; no se redondean productos o
subtotales intermedios. Se persiste/presenta ese valor y se compara
ese mismo valor mostrado contra la nota mínima vigente del curso
(`minimum_grade`). La referencia inicial es 70/100, pero 70 es un default
provisional de configuración del curso, no una regla universal inmutable.

Si falta una nota requerida, el resultado se marca explícitamente incompleto o
pendiente. No se exime al participante ni se muestra el resultado como completo:
para la decisión académica, una evaluación incompleta equivale explícitamente a
0 hasta completar las notas faltantes. La interfaz debe distinguir ese 0
provisional/incompleto de una evaluación completa cuya nota final sea realmente 0.

No hay tolerancias ocultas en la suma de pesos ni doble redondeo. Toda validación
repite las reglas en servidor; los controles de interfaz no son autoridad.

## Participantes, roles y ventana

- Solo participantes con preinscripción en estado `INSCRITO` son evaluables.
  `PREINSCRITO` y `SALDOVENCIDO` no califican.
- Un instructor solo gestiona evaluaciones de cursos propios y desde el inicio
  oficial del curso.
- `ADMIN` puede gestionar evaluaciones de cualquier curso y conserva acceso
  administrativo independientemente de que también posea rol `INSTRUCTOR`.
- El estado de elegibilidad derivado de asistencia no bloquea ni impide registrar
  notas. No se convierte una regla de asistencia en una condición de la
  evaluación.

Las rutas, queries, DTOs y comandos deben aplicar autorización/ownership en
servidor y limitar los datos de participantes al roster permitido del curso.

## Integridad y auditoría

Las notas deben conservar precisión decimal y vínculo inequívoco entre curso,
componente y participante elegible. Las correcciones de notas son auditables;
el registro debe permitir identificar el cambio y su actor. No se exige en este
contrato una razón obligatoria para corregir. Los componentes/pesos no pueden
mutarse después del primer valor de nota persistido, aunque luego se corrija o
elimine esa nota; el estado de congelamiento debe permanecer verdadero.

La implementación debe probar validación exacta de suma de pesos, rango y
precisión, cálculo sin redondeo intermedio, el límite de nota mínima usando el
mismo redondeo presentado, estado incompleto, congelamiento al guardar cero,
autorización ADMIN/INSTRUCTOR, ventana de instructor, exclusión de estados
distintos de `INSCRITO` e independencia de la elegibilidad por asistencia.

## Fuera de alcance explícito

- Cerrar o reabrir cursos; planilla oficial, informe y firmas (Fase 8).
- Cambiar componentes/pesos tras existir la primera nota persistida.
- Eximir evaluaciones o participantes de componentes faltantes.
- Bloquear la calificación por asistencia.
- Certificados, PDF, firmas de certificado, QR, verificación o revocación
  (Fase 9).
