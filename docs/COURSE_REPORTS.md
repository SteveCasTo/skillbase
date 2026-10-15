# Informes de cursos

`GET /app/cursos/exportar?format=PDF|CSV&search=…&status=…` es exclusivo de
ADMIN activo. Middleware valida sesión actual; caso de uso y repositorio
revalidan autorización. Las respuestas son privadas, `no-store`, `nosniff` y
attachment. No se almacenan documentos ni se modifican datos o snapshots.

## Alcance y fuentes

- Exporta todos los cursos del filtro de nombre/slug (misma normalización de
  búsqueda que el listado), con estado editorial PUBLISHED por defecto, o DRAFT,
  ARCHIVED o ALL seleccionados. No depende de la página ni de las tarjetas
  cargadas en el navegador. Conserva cursos sin grupos o sin inscritos.
- Máximo 1000 filas de informe (grupos más cursos sin grupos), además del límite
  de 1000 cursos y grupos; exceder cualquiera rechaza el informe entero,
  nunca trunca. Las consultas por lote comparten una transacción repeatable-read
  con revalidación ADMIN. No hay consultas por persona o por curso.
- Instructor: nombre humano actual de `courses.instructorId`, nunca historial,
  instructor del cierre ni texto legado. Sin relación: «Sin asignar».
- Precios: revisión de formato referenciada por el curso. Auxiliar aplica el
  descuento global actual usando la función de precios existente; son precios
  de curso, no una afirmación sobre el precio aplicado a cada inscripción.
- Fase académica reutiliza la política vigente. Las fechas nominales del curso
  se distinguen de las de cada grupo: para este último se toma el rango de
  sesiones actuales no canceladas, incluidas recuperaciones. Sin calendario
  materializado se usan fechas/horas del grupo y días configurados del curso.
  Todas las fechas y horas se presentan en Bolivia. El ordinal de grupo es solo
  de presentación, ordenado por inicio/fin e ID estable como desempate interno.

## Métricas

Solo registros cuya pertenencia **actual** es `INSCRITO` según la política
existente. No se muestran otros estados, sus contadores ni saldo financiero.
Personas distintas por grupo; personas distintas por curso deduplicadas entre
grupos. El resumen global cuenta personas únicas entre todos los cursos, no la
suma de sus subtotales. Dinero = PAYMENT menos REFUND de esos mismos registros,
en centavos enteros exactos, incluyendo todas sus devoluciones registradas. El
neto global suma una sola vez los grupos, nunca grupos más cursos.

Aprobados/No aprobados usan exclusivamente `academicallyPassed` combinado del
snapshot oficial vigente: grupo cerrado y versión oficial = última versión.
Se reconcilia por registrationId y participantId con inscritos actuales. Un
inscrito actual ausente o una evidencia incoherente bloquea el informe; no se
inventa cero. Abierto/reabierto muestra raya en PDF y celdas vacías en CSV. No
se infiere resultado por emisión o ausencia de PDF/certificado.

## Formatos

PDF institucional independiente del financiero de preinscripciones: A4 vertical,
títulos Montserrat, Noto Sans embebida para texto y Unicode, encabezado/pie,
tablas compactas con encabezados y curso repetidos en continuaciones. Nunca
trunca texto; glifos no soportados o contenido mayor que una página rechazan
PDF explícitamente, preservando CSV como alternativa. No incluye CI, nombres de
estudiantes, emails, UUID ni rutas internas.

CSV UTF-8 BOM, coma, CRLF, quoting y protección frente a fórmulas en textos.
Una fila por grupo, con metadatos del curso repetidos y métricas **del grupo**
sumables (neto, aprobados y no aprobados). Cantidad de grupos y precios son
atributos repetidos, no medidas aditivas. Inscritos por grupo no representan
personas globalmente únicas. No se repiten totales monetarios/de inscritos del
curso por fila. Un curso sin grupos conserva una fila con grupo vacío, inscritos
y neto cero y resultados vacíos. Importes con dos decimales exactos.

Las acciones PDF/CSV junto a Nuevo curso conservan filtros y usan Sileo promise
sobre la descarga real: solo confirman tras validar respuesta, MIME, attachment
y contenido completo PDF/BOM CSV. Redirecciones/HTML y errores no se descargan
como archivos; las acciones recuperan disponibilidad para reintentar.
