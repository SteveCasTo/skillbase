# DECISIONS

## OBJETIVO

Registrar decisiones técnicas relevantes y su contexto.

Este archivo no debe convertirse en un diario de cambios menores.

## FORMATO ADR

Cada decisión debe incluir:

- ID.
- fecha.
- estado.
- contexto.
- decisión.
- alternativas.
- consecuencias.

Estados:

- Proposed.
- Accepted.
- Superseded.
- Deprecated.

---

## ADR-001 — SUPABASE COMO BACKEND PLATFORM

**Estado:** Accepted

### Contexto

El sistema requiere PostgreSQL, autenticación, Google OAuth, almacenamiento de archivos y un entorno local reproducible.

### Decisión

Usar Supabase para:

- PostgreSQL;
- Auth;
- Storage;
- entorno local.

### Alternativas

- Firebase.
- Cloudflare D1/R2.
- PostgreSQL y servicios independientes.

### Consecuencias

Positivas:

- modelo relacional;
- local development;
- menor cantidad de infraestructura propia;
- Auth y Storage integrados.

Negativas:

- dependencia de Supabase en algunas capacidades;
- necesidad de mantener migraciones y configuración consistentes.

---

## ADR-002 — MONOLITO MODULAR

**Estado:** Accepted

### Decisión

Iniciar con Astro full-stack y no crear backend independiente.

### Motivo

Existe un único cliente web y no hay aún integraciones que justifiquen un servicio separado.

### Regla de evolución

Evaluar Elysia + Bun si aparece:

- múltiples clientes;
- API externa;
- integración institucional compleja;
- procesamiento independiente;
- escalado separado.

---

## ADR-003 — DRIZZLE

**Estado:** Accepted

### Decisión

Usar Drizzle para acceso tipado a PostgreSQL.

### Consecuencia

La lógica de datos debe pasar por repositories/services.

No utilizar Supabase Data API como mecanismo principal para lógica de negocio del servidor.

---

## ADR-004 — SUPABASE LOCAL

**Estado:** Accepted

### Decisión

Usar Supabase local mediante CLI y Docker para desarrollo e integración.

### Motivo

Mantener similitud entre development y production.

SQLite no se utilizará como sustituto de PostgreSQL para desarrollo.

---

## ADR-005 — VERCEL

**Estado:** Accepted

### Decisión

Desplegar producción en Vercel.

El despliegue de `master` se ejecutará después de CI exitoso.

---

## ADR-006 — GITHUB ACTIONS COMO GATE

**Estado:** Accepted

### Decisión

Todo release desde `master` requiere:

- lint;
- typecheck;
- tests;
- build.

Las migraciones pendientes se aplicarán a Supabase Cloud desde CI antes del despliegue final.

---

## ADR-007 — SHADCN/UI

**Estado:** Accepted

### Decisión

Usar shadcn/ui como base del sistema de componentes.

### Motivo

Reduce trabajo repetitivo manteniendo control sobre el código.

---

## ADR-008 — SILEO

**Estado:** Accepted with validation

### Decisión

Usar Sileo como toast principal.

### Condiciones

- validar accesibilidad;
- verificar reduced motion;
- no usar toast para información crítica;
- mantener fallback visual coherente si una necesidad no está cubierta.

---

## ADR-009 — GOOGLE AUTH

**Estado:** Accepted

### Decisión

Google OAuth será gestionado mediante Supabase Auth.

El usuario interno no utilizará `googleId` como PK.

La identidad de proveedor debe permanecer desacoplada del identificador de dominio.

---

## ADR-010 — SIN STAGING INICIAL

**Estado:** Accepted

### Decisión

No mantener staging permanente mientras el sistema aún no tenga uso productivo real.

Entornos:

- local development;
- isolated testing;
- preview cuando corresponda;
- production.

Reevaluar staging después del lanzamiento.

---

## ADR-011 — DRIZZLE CONTROLA LAS MIGRACIONES DE APLICACIÓN

**Fecha:** 2026-09-13

**Estado:** Accepted

### Contexto

Supabase CLI y Drizzle pueden mantener historiales de migración independientes. Usar ambos para las mismas tablas generaría orden ambiguo y resets locales distintos de producción.

### Decisión

Drizzle Kit genera y aplica las migraciones del schema de aplicación. Supabase CLI administra el stack local y reinicia los servicios; después de cada reset se ejecutan las migraciones Drizzle.

Los objetos propios de la plataforma Supabase solo tendrán una migración específica si una capacidad futura no puede representarse de forma coherente con el schema Drizzle.

### Alternativas

- Mantener dos historiales para las mismas tablas.
- Escribir migraciones Supabase manuales y usar Drizzle solo para queries.

### Consecuencias

- Existe una única fuente versionada para las entidades de aplicación.
- Desarrollo, CI y producción ejecutan `drizzle-kit migrate`.
- Foundation contiene metadata Drizzle, pero ninguna tabla de negocio anticipada.

---

## ADR-012 — IDENTIDAD AUTH E INVITACIONES INTERNAS

**Fecha:** 2026-09-14

**Estado:** Accepted

### Contexto

Supabase Auth controla identidades y sesiones, pero los permisos institucionales deben ser preaprovisionados, soportar múltiples roles y poder deshabilitarse sin eliminar la identidad externa.

### Decisión

Mantener `auth.users` fuera del schema Drizzle. Una invitación interna se identifica por correo normalizado y se vincula una sola vez al UUID Auth después de un Google OAuth exitoso con correo verificado. Roles y estado viven únicamente en tablas internas. No se añade FK cross-schema: se usa unicidad DB y vinculación transaccional en aplicación.

Las tablas públicas quedan sin acceso por Data API para `anon`/`authenticated`; Astro con Drizzle aplica la autorización operativa.

### Consecuencias

- Deshabilitar el usuario interno corta acceso aunque la sesión Google siga siendo válida.
- Los cambios de rol se observan en el siguiente request sin esperar a renovar JWT.
- El proceso de preaprovisionamiento no necesita privilegios sobre el schema `auth`.
- Los fixtures automatizados pueden crear identidades locales por Admin API sin alterar el mecanismo visible de login.

---

## ADR-013 — URLs DB SEPARADAS PARA RUNTIME Y MIGRACIONES

**Fecha:** 2026-09-14

**Estado:** Accepted

### Decisión

`DATABASE_URL` es la conexión server-side de runtime y `MIGRATION_DATABASE_URL` es la conexión directa preferida por Drizzle Kit. Localmente pueden ser iguales; en Vercel el runtime puede usar pooler mientras las migraciones conservan una conexión directa.

---

## ADR-014 — NOMBRE DE PRODUCTO PROVISIONAL

**Fecha:** 2026-09-15

**Estado:** Proposed

### Contexto

`SkillBase` identifica actualmente al proyecto, pero todavía no existe una decisión definitiva de marca. Se estima en un 80 % la probabilidad de cambiar el nombre durante el desarrollo, cuando el alcance funcional y la identidad del producto estén más definidos.

### Decisión

Mantener `SkillBase` como nombre provisional sin iniciar por ahora un proceso de rebranding. La landing puede evolucionar durante esta etapa, pero la identidad visible debe permanecer centralizada y desacoplada de reglas de negocio, identificadores persistidos o integraciones que dificulten un cambio posterior.

### Alternativas

- Adoptar `SkillBase` como nombre definitivo desde esta etapa.
- Cambiar el nombre antes de implementar los siguientes módulos.
- Posponer la decisión hasta validar una parte mayor del flujo interno.

### Consecuencias

- Los dominios, textos de marca y metadatos podrán cambiar más adelante.
- Los nombres técnicos existentes no se renombran sin una decisión posterior explícita.
- La landing puede implementarse con la identidad provisional, evitando decisiones de marca difíciles de sustituir.

---

## ADR-015 — CICLO EDITORIAL Y CONTRATOS DE CURSO

**Fecha:** 2026-09-15

**Estado:** Accepted

### Contexto

La gestión administrativa debe alimentar una experiencia pública posterior sin mezclar publicación editorial, disponibilidad de preinscripción ni calendario operativo de grupos. Los cambios sobre cursos publicados y precios necesitan trazabilidad.

### Decisión

Modelar el curso con estados `DRAFT`, `PUBLISHED` y `ARCHIVED`. Publicar transforma borrador en publicado; retirar transforma publicado en borrador y se audita como retiro; archivar no borra y es terminal en Fase 2A. La disponibilidad de preinscripción se deriva de una ventana opcional válida y no se persiste.

Generar un slug único y normalizado al crear, resolver colisiones de forma transaccional y mantenerlo inmutable. Persistir precios obligatorios `STUDENT` y `EXTERNAL` como `numeric(12,2)` y strings TypeScript, con moneda `BOB`. Mantener DTO administrativo y DTO público separados; el segundo solo se produce para `PUBLISHED`. En Fase 2A el DTO público existe como contrato de repositorio, pero todavía no hay rutas HTTP públicas.

Astro SSR coordina formularios POST en páginas dedicadas. Los casos de uso autorizan `ADMIN`, el repositorio Drizzle conserva atomicidad entre entidad, precios y `audit_events`, y no se expone Data API.

Los valores `datetime-local` se definen como tiempo civil `America/La_Paz` y se convierten simétricamente con UTC-04, sin consultar el timezone del runtime. `updatedAt` actúa como revisión optimista para edición. Un advisory lock global serializa la asignación de slugs; las transiciones continúan usando bloqueo de fila. Todo éxito mutable finaliza con Post/Redirect/Get `303`.

### Alternativas

- Combinar publicación y preinscripción en un único estado.
- Regenerar el slug al editar el nombre.
- Persistir disponibilidad calculada.
- Exponer las tablas mediante Supabase Data API.

### Consecuencias

- El calendario público actual es informativo; grupos futuros podrán definir el operativo sin reinterpretar cursos existentes.
- Retirar conserva curso, URL y trazabilidad, pero lo oculta de lecturas públicas.
- Editar contenido o precios publicados es posible y auditable.
- Ediciones obsoletas se rechazan sin pérdida silenciosa y los no-op no generan eventos de cambio.
- La serialización global sacrifica paralelismo mínimo durante la breve asignación de slug a cambio de unicidad determinista para bases solapadas.
- Fase 2B puede consumir un contrato público estable sin acceder a campos administrativos ni cambiar la persistencia.

**Nota de vigencia:** el almacenamiento directo de duración y precios descrito aquí refleja la implementación original de Fase 2A y quedó sustituido por ADR-016 y la refactorización local implementada. El resto del ciclo editorial, slug, autorización y auditoría de ADR-015 permanece vigente. El estado CI/cloud de los cambios actuales requiere verificación independiente.

---

## ADR-016 — TIPOS DE CURSO Y REVISIONES INMUTABLES

**Fecha:** 2026-09-18

**Estado:** Accepted — implementado localmente; verificación de cierre pendiente

### Contexto

Fase 2A almacena `totalHours` y los precios `STUDENT`/`EXTERNAL` directamente por curso. Este modelo permite duplicar valores y no expresa que duración y precios son una configuración administrativa reutilizable. También se aprobó una jerarquía pública que separa el resumen de una tarjeta de la información comercial y operativa detallada.

### Decisión

- Introducir Tipos de curso o formatos administrados. Cada tipo define duración y precios `STUDENT`/`EXTERNAL` en `BOB`.
- Exigir que cada curso seleccione exactamente un tipo y no pueda sobrescribir sus horas ni precios.
- Representar las ediciones mediante revisiones inmutables del tipo. Una edición crea una nueva revisión: cursos borrador/no publicados adoptan la revisión vigente, mientras que cursos publicados y archivados conservan exactamente la revisión utilizada.
- Permitir activar o desactivar tipos sin eliminar revisiones ni alterar cursos históricos.
- Permitir una fotografía propia opcional por curso solo cuando esté autorizada. La ausencia se resuelve con un fallback gráfico de Cota Activa. La persistencia de una key canónica y el upload/storage administrativo en bucket público controlado están implementados; el cliente no proporciona una URL arbitraria.
- En la landing, las tarjetas muestran disponibilidad, título, descripción breve, inicio/fecha, nivel y duración, sin precios detallados ni horario detallado. El catálogo `/cursos` y el detalle `/cursos/[slug]` ya están implementados por SSR; el detalle publica horario informativo, condiciones y precios diferenciados.
- Presentar las alternativas cartelera editorial, catálogo visual modular y agenda cronológica antes de cerrar la dirección pública. El 2026-09-18 se seleccionó **Cartelera editorial**: una convocatoria panorámica dominante, afiches secundarios, fotografía opcional y fallback gráfico Cota Activa.

### Alternativas

- Mantener duración y precios como campos directos de cada curso.
- Mutar un único valor de tipo y propagarlo también a cursos publicados o archivados.
- Copiar valores en cada curso sin conservar una revisión inmutable del tipo.

### Consecuencias

- La administración obtiene una fuente reutilizable y auditable para duración y precios.
- Los borradores/no publicados siguen la configuración vigente, mientras que publicados y archivados conservan una representación histórica exacta.
- Será necesario migrar el modelo directo actual, adaptar contratos administrativos y públicos, y verificar las reglas de asignación y publicación antes de cerrar Fase 2B.
- Formatos administrados, revisiones inmutables, referencia obligatoria desde cada curso y migración del modelo directo están implementados. Las pruebas locales están en el repositorio; el estado actual de CI/cloud y el cierre de revisión no se dan por verificados por esta decisión.
- Esta decisión sustituye únicamente las partes de ADR-015 relativas al almacenamiento directo y la edición de duración/precios; no reemplaza sus reglas de ciclo editorial, slug, autorización, auditoría ni fechas.
- El bucket público `course-artwork` contiene únicamente artwork destinado a publicación. La carga se valida/autorizada en servidor; previews sintéticos y fallback gráfico siguen disponibles.
- La cartelera agrupa afiches en tríos, convierte cuatro remanentes en dos pares y deja un remanente único en una fila completa; desktop varía proporciones, tablet equilibra dos columnas y mobile usa una columna uniforme. Cada pieza es un enlace de tarjeta completa.

Los formatos de desarrollo seeded (20 horas: Bs 80/100; 30 horas: Bs 120/150) son valores iniciales editables de entorno local, no una tarifa universal ni un precio para auxiliares.

---

## ADR-017 — MUTACIONES ADMINISTRATIVAS SIN RECARGA

**Fecha:** 2026-09-26

**Estado:** Accepted — aplicación progresiva

### Contexto

Las recargas completas tras guardar, eliminar o cambiar un estado interrumpen el trabajo en formularios, la posición de lectura y los controles interactivos. El contrato SSR de las páginas administrativas ya ofrece POST HTML y validación de servidor.

### Decisión

Con JavaScript, toda mutación administrativa (incluidas altas, ediciones, cambios de estado y eliminaciones) debe confirmar en la interfaz y actualizar el contenido pertinente sin recargar el documento. Los POST con `Accept: application/json` reutilizan el mismo caso de uso, autorización, comprobación de origen, validación y control de concurrencia que el formulario HTML. Errores persistentes y revisiones optimistas se reflejan en la vista. Para acciones irreversibles o de alto impacto se pide confirmación accesible; al aceptar, el diálogo se cierra y la solicitud continúa con feedback pending/success/error independiente. No se comunica éxito ni se navega antes de que el servidor confirme; después se actualiza localmente la vista afectada, sin navegación completa. Las acciones duplicadas se bloquean mientras hay una petición pendiente. Sin JavaScript se conserva POST/redirect y una confirmación HTML utilizable.

### Alternativas

- Recargar la página después de cada operación.
- Mantener una implementación de reglas distinta en el cliente.

### Consecuencias

- La interfaz debe sincronizar los datos y tokens devueltos por el servidor y ofrecer recuperación si la sesión caduca o falla una solicitud.
- Los tests cubren resultados del servidor, continuidad de la página, foco y el fallback sin JavaScript por flujo; las mutaciones que aún hacen redirect con JavaScript se migran por fases.
- Esta decisión reemplaza la exigencia de Post/Redirect/Get para **todo** éxito mutable en ADR-015: PRG permanece para el fallback HTML.

La extensión del 2026-09-30 precisa el ciclo de confirmación y feedback; no altera la autorización server-side ni elimina el fallback HTML.

---

## ADR-018 — PLANIFICACIÓN EDITORIAL DE LUNES A VIERNES

**Fecha:** 2026-09-26

**Estado:** Accepted — implementación de calendario editorial

### Contexto

Los checkboxes de días y el horario de texto libre no permiten derivar la fecha de finalización ni garantizar que el tiempo de cada clase coincida con el formato. Los cursos existentes y publicados contienen únicamente horas nominales y fechas informativas; no se conoce la duración histórica de sus sesiones.

### Decisión

Agregar minutos por sesión a cada nueva revisión inmutable de formato. Para cursos nuevos, fijar lunes a viernes, calcular el fin diario a partir del inicio civil de Bolivia y derivar la fecha final con sesiones completas, redondeando al número más cercano (empates hacia arriba). Mostrar por separado horas nominales del formato y horas planificadas cuando difieran: 20 h/90 min → 13 sesiones/19,5 h; 30 h/150 min → 12 sesiones/30 h. El fin es fijo; se cambia el formato o el inicio, no se edita la hora final. Revalidar en servidor y recalcular borradores al revisar un formato.

Los cursos y revisiones históricos sin dato verificable conservan horario libre y `session_minutes = NULL`, respectivamente. La migración solo asigna 90/150 minutos a los ejemplos conocidos cuya revisión coincide por nombre, duración y precios; no inventa horarios pasados. La preinscripción opcional cierra antes del inicio. Los feriados, recuperaciones y calendarios operativos pertenecen a grupos futuros.

### Alternativas

- Conservar checkboxes de días y horarios libres en cursos nuevos.
- Redondear a sesiones parciales o contabilizar 20 h como 21 h exactas.
- Atribuir duración de sesión a todas las revisiones históricas según sus horas nominales.

### Consecuencias

- El planificador de dominio y el repositorio usan tiempo civil `America/La_Paz`, verifican las fechas derivadas y conservan las revisiones históricas de cursos publicados/archivados.
- Esta planificación sigue siendo **editorial**; los futuros grupos definen sus horarios propios sin deducir asistencia ni inscripción de los cursos históricos.
- Los cursos nuevos requieren formatos con duración de sesión conocida. La migración es aditiva y se prueba sobre datos legados además de una base nueva.

---

## ADR-019 — GRUPOS CON CUPO Y HORARIO PROPIOS

**Fecha:** 2026-09-27

**Estado:** Accepted — administración de grupos inicial

### Contexto

Un curso puede atraer más participantes que los disponibles en un solo horario. La preinscripción y la inscripción todavía no están implementadas; no existen identidades de instructor asignadas a grupos ni aulas registradas. El calendario del curso tiene carácter editorial.

### Decisión

Cada curso publicado y planificado puede tener varios grupos con capacidad máxima individual positiva y sin mínimo automático. Todos comparten fechas L–V e instructor textual del curso, pero tienen hora de inicio distinta y fin derivado de la revisión de formato fijada. Solo los grupos planificados **del mismo curso** no pueden solaparse; los horarios contiguos y los de otros cursos sí. Administración puede ajustar horario/cupo o cancelar un grupo sin borrarlo; no se distribuyen participantes automáticamente.

Una transacción bloquea el curso antes de comprobar conflictos y escribir grupos, con revisión optimista y auditoría. El curso conserva fechas y revisión vinculadas a grupos, incluso si vuelve a borrador, y su republicación exige un formato activo. El módulo usa casos de uso autorizados `ADMIN`, ruta privada enumerada, RLS y tabla sin grants Data API.

La relación compuesta grupo → (curso, revisión) impide vincular una revisión ajena incluso fuera de la aplicación. Se admite cancelar grupos existentes después de retirar o archivar el curso; crear y cambiar horarios requiere publicación. El cupo está limitado al máximo `integer` de PostgreSQL.

### Alternativas

- Tratar cada grupo como un curso independiente.
- Guardar un cupo global del curso y repartir estudiantes automáticamente.
- Bloquear horarios entre cursos distintos sin datos de aulas o asignación real de instructores.

### Consecuencias

- La capacidad cuenta como límite configurado, no como matrícula confirmada; los grupos cancelados conservan registro pero dejan de competir por horarios.
- La elección y cambio de grupo por participantes, conteo real de ocupación, cancelaciones con inscripciones/pagos y sesiones de feriados requieren módulos posteriores de preinscripción, inscripción y operación.
- El detalle público mantiene el horario editorial existente hasta que la selección de grupo y la disponibilidad real se implementen en el contrato público.

---

## ADR-020 — FECHAS COMUNES Y HORAS POR GRUPO

**Fecha:** 2026-09-27

**Estado:** Accepted

### Contexto

El curso tenía una hora de inicio y fin editorial calculada que se confundía con el horario real de sus grupos. Se necesita preparar varios grupos antes de publicar, sin cambiar los calendarios ya asignados ni los cursos históricos. El token de edición del curso perdía microsegundos al pasar de PostgreSQL a `Date`/ISO, causando falsos conflictos.

### Decisión

- Un curso nuevo planificado comparte fechas civiles de inicio y fin de Bolivia (almacenadas como 00:00 y 23:59), días L–V y duración de sesión. Cada grupo tiene su hora inicial, hora final derivada y cupo propio; `schedule` sigue siendo texto de compatibilidad sin atribuir una hora al curso.
- El borrador puede tener cero o varios grupos. En el alta se guarda primero el curso y después se crean los grupos configurados; el reintento no vuelve a crear el borrador ni los grupos confirmados. La pestaña «Grupos» permite gestionar grupos en borrador o publicado, no en archivado. El primer grupo fija las fechas y revisión de formato también en borrador.
- Los cursos históricos con grupos o con cierre de preinscripción a partir de la medianoche del primer día conservan sus instantes horarios; los demás cursos antiguos sin grupos y con horario estructurado generado se normalizan a fechas comunes. Se conserva el bloqueo del calendario con grupos y la validez de ventanas de preinscripción. Los demás cursos conservan su horario informativo.
- `courses.updated_at` usa `timestamptz(3)` para que la comparación SQL de revisión coincida exactamente con el token de milisegundos enviado desde el navegador; no se elimina la comprobación optimista.

### Alternativas

- Mantener una hora global en el curso y obligar a los grupos a compartirla.
- Exigir al menos un grupo antes de guardar un borrador.
- Ignorar la revisión SQL al guardar, con riesgo de sobrescribir ediciones simultáneas.

### Consecuencias

- Las reglas horarias de ADR-018 y las restricciones de publicación para crear o cambiar grupos de ADR-019 quedan sustituidas por esta decisión; el cálculo de sesiones, la compatibilidad histórica, la auditoría y el control de solapamiento permanecen vigentes.
- El alta con grupos e imagen realiza varias escrituras autorizadas: si alguna falla, conserva el borrador y ofrece reintentar las operaciones pendientes o abrirlo. No se anuncia atomicidad entre Storage y PostgreSQL.

---

## ADR-021 — ESTADOS Y MÉTRICAS DE INTERESADOS

**Fecha:** 2026-09-30

**Estado:** Accepted

### Contexto

Fase 3 recoge registros de interés sin pago ni asignación de cupo. Se requiere distinguir registros vigentes de cancelados y consultar demanda por preferencia sin confundirla con grupos o plazas.

### Decisión

- Usar estados `ACTIVE` y `CANCELLED`. Administración puede cancelar y reactivar un interesado, conservando su historial.
- Contabilizar interesados `ACTIVE` por curso y por preferencia de grupo. La preferencia es una dimensión separada: no asigna grupo ni representa plazas/cupos disponibles u ocupados.
- No interpretar `ACTIVE` como aceptación de la persona, reserva, preinscripción presencial, inscripción ni pago.

### Alternativas

- Mantener registros sin estado y derivar solo el conteo total.
- Borrar registros cancelados en vez de conservarlos.

### Consecuencias

- Los contratos técnicos, la persistencia, la autorización y la implementación de estas reglas aún deben definirse y completarse en Fase 3.
- Conservar registros cancelados permite mantener historial; las métricas acordadas cuentan únicamente interesados activos y nunca sustituyen datos de asignación u ocupación de grupos.

---

## ADR-022 — REGISTRO PÚBLICO DE INTERESADOS SIN PAGO

**Fecha:** 2026-09-30

**Estado:** Accepted

### Contexto

El término «preinscripción» se reserva para el registro presencial que registra pago parcial o total y ocupa cupo. Fase 3 requiere captar demanda pública mediante registros de interesados, distinguiéndolos de esa preinscripción presencial.

### Decisión

- Fase 3 registra interesados, no preinscripciones presenciales pagadas. El registro no cobra, asigna grupo ni ocupa cupo, y no comunica aceptación.
- Modelar el registro de interesado como agregado autónomo, separado de `Participant` y de la preinscripción presencial. El email público no verificado no es identidad global y nunca autoriza sobrescribir datos de `Participant`.
- El único punto de entrada público es el detalle `/cursos/[slug]`; no se cambia ni añade información a la landing.
- Nombre, apellidos y email son obligatorios; teléfono y preferencia de grupo son opcionales. Se admite como máximo un registro por curso y email normalizado.
- El servidor valida disponibilidad: desde que el curso está `PUBLISHED` hasta el cierre de inscripción presencial si tiene ventana configurada, o hasta el inicio oficial si no la tiene. Se rechazan cursos retirados o archivados.
- La preinscripción presencial pertenece a Fase 5: puede registrarse directamente o usar el interesado como prellenado editable, completa los datos administrativos pendientes y registra pago parcial o total al ocupar cupo. El uso del interesado requiere un vínculo explícito y trazable; no implica que la preinscripción pagada herede una identidad global, ni permite inferir pago a partir del interesado. No se define aquí una transición posterior a inscripción definitiva. Cambios de grupo y devoluciones pertenecen también a Fase 5; no se duplican en Fase 3.
- Al cierre de disponibilidad pública no se eliminan automáticamente interesados: el formulario deja de aceptar registros y el historial sigue disponible para administración. La política futura de conservación y anonimización, incluido un plazo, queda pendiente; no se promete conservación perpetua.
- Las reglas monetarias y datos aún por confirmar (precio aplicado, descuentos, pagos, documentos y boleta) no se adelantan como decisiones de Fase 3.

### Alternativas

- Tratar el registro público de interesado como preinscripción presencial con pago y ocupación de cupo.
- Añadir una llamada a la acción o información nueva en la landing.

### Consecuencias

- El modelo de Fase 3 debe distinguir interesados de preinscripciones presenciales y validar duplicados y elegibilidad en servidor.
- La entidad persistida y el contrato técnico concreto se definirán antes de su migración; las reglas de estado y métricas aprobadas están en ADR-021.
- Los interesados sirven para conocer demanda, pero no crean disponibilidad, capacidad ni compromisos financieros. La preinscripción presencial ocupa cupo; su posible paso a inscripción definitiva queda fuera de esta decisión.
- La separación evita tratar datos de contacto declarados públicamente como identidad verificada. Cierre de captación no equivale a borrado; el plazo de conservación y la anonimización requieren una decisión posterior de privacidad.

Implementación local de ADR-017 (2026-09-30): la carga estructural SSR se coordina con navegación, viewport y cancelación; grupos/formatos aplican actualización local. El alta de curso usa idempotencia actor + UUID + fingerprint persistida en la propia fila de curso (migración 0010), no una tabla de recibos separada ni limpieza automática. La foto sigue siendo una operación posterior al alta con recuperación del borrador, no una transacción atómica DB/Storage. Esta precisión no cambia reglas de negocio ni declara cerrado el gate de validación.

Detalle de implementación local de ADR-017: los productores administrativos pasan por `src/lib/notifications.ts`, que crea un UUID por operación y reutiliza el ID para loading/success/error. El bridge adapta el `id` de runtime de Sileo 0.1.5 sin `any` ni patch en dependencias instaladas. Esto no cambia la decisión de mantener la mejora progresiva/fallback SSR ni la política existente de movimiento reducido.

---

## ADR-023 — PERFILES, CUENTAS Y ASIGNACIÓN DE INSTRUCTORES

**Fecha:** 2026-10-01

**Estado:** Accepted — flujos aprobados desplegados/verificados mediante PR 126; baja de instructor no incluida

### Contexto

Los grupos existen, pero la identidad del instructor aún es texto opcional del curso. Es necesario habilitar cuentas de instructor con acceso acotado y asignar una persona real sin confundir roles internos, datos públicos o credenciales.

### Decisión

- Mantener perfil de instructor y usuario interno/roles vinculados a identidad Supabase Auth; credenciales solo viven en Auth. ADMIN aprovisiona cuenta desde servidor y establece contraseña inicial, sin invitación ni paso forzado de cambio. Email/password se suma al Google vigente sin habilitar signup público.
- Google se enlaza explícitamente a la misma cuenta autenticada únicamente con proveedor verificado y email normalizado coincidente; no realizar fusión automática. Los ADMIN existentes mantienen Google y pueden añadir contraseña; no se añade administración de creación de ADMIN.
- Un curso tiene una única asignación de instructor, heredada por todos sus grupos. Instructor accede solo a perfil propio y cursos asignados; asistencia/sesiones siguen en Fase 6.
- El cambio de instructor se permite en curso publicado solo antes del inicio oficial. Conflictos del mismo instructor entre cursos se calculan con fechas L–V y tiempo civil `America/La_Paz`; intervalos semiabiertos hacen válido el contacto exacto de turnos. Escrituras concurrentes que puedan alterar ese cálculo deben compartir serialización transaccional.
- Conservar IDs e historial de perfiles usados y auditar asignaciones/mutaciones sin credenciales. No se añade flujo de desactivación de instructor con cursos futuros; esa política queda sin definir y fuera de la operación cubierta por esta decisión.

### Alternativas

- Mantener nombre de instructor como texto libre.
- Habilitar solo OAuth Google o crear una invitación con onboarding/cambio obligatorio.
- Vincular Google automáticamente por email sin acción autenticada.
- Asignar instructor por grupo o permitir varios instructores por curso.

### Consecuencias

- Se amplían los métodos visibles de login para cuentas internas, no el signup público; se deben preservar guardas, política exacta por ruta, CSRF/cookies/redirects y configuraciones de Auth.
- Las decisiones de asignación/horario exigen pruebas de concurrencia compartidas con mutaciones de fechas, grupos y publicación; una comprobación en UI no basta.
- Perfiles estables, asignación `courses.instructor_id`, tabla de historial, guards de perfil/cursos y validaciones de calendario se añadieron mediante PR 120/migración 0014. PR 126 aplicó la migración en producción y verificó el flujo. La política de desactivación no forma parte de los flujos aprobados aquí y permanece sin decisión.
- Para evitar carreras, el repositorio usa una barrera advisory-lock transaccional común; adquiere locks de IDs de instructor previo/nuevo en orden estable y después la fila del curso. La misma serialización cubre cambios de asignación/fechas/publicación y escrituras de horario/estado de grupos. Conserva auditoría, revisión optimista e historial; no cambia el límite modular ni introduce un calendario separado.
- Debe comprobarse configuración SMTP cloud antes de afirmar recuperación de contraseña disponible; esto no bloquea cuentas creadas con password por ADMIN ni su login inicial.

---

## ADR-024 — APROBACIÓN DE GOOGLE EN LA CAPA DE APLICACIÓN

**Fecha:** 2026-10-01

**Estado:** Accepted — implementado, integrado y desplegado mediante PRs 118/126; Google real pendiente de verificación

### Contexto

Supabase Auth puede asociar automáticamente una identidad Google cuando el proveedor verifica que su correo coincide con el correo de una cuenta existente. Ese comportamiento de asociación a nivel proveedor no se puede usar como prueba de consentimiento explícito ni se documenta como configurable para impedirlo. Sin otra comprobación, que Google aparezca en `auth.users.identities` podría convertir una sesión OAuth no solicitada en login de SkillBase.

### Decisión

- Mantener `auth_primary_provider` y `approved_google_identity_id` en el usuario interno. Autorizar OAuth Google solo si el método actual de la sesión, validado desde claims firmados, es OAuth y la identidad Google es admisible: identidad vigente del usuario legado `GOOGLE` o identidad asociada explícitamente/aprobada para cuenta `EMAIL`, siempre con correo verificado normalizado coincidente.
- Permitir sesiones PASSWORD y confirmación de email según su flujo validado, sin exigir que una asociación Google de proveedor exista o esté aprobada. Así una identidad Google autoasociada no deshabilita el acceso por contraseña.
- La asociación explícita usa flujo ligado a usuario interno y sesión originales, PKCE/flowId, nonce de un uso y expiración breve; valida identidad Auth y email tras el callback. Al rechazo se intenta quitar solo la nueva identidad agregada y restaurar la sesión original. La autorización sigue dependiendo del estado persistido de aprobación, no del éxito de unlink.
- No fusionar usuarios internos automáticamente por email; el vínculo proveedor en Auth no equivale a merge de cuentas de dominio.

### Alternativas

- Confiar en que Supabase no asocie automáticamente identidades coincidentes.
- Considerar cualquier identidad Google visible en `getUser()` como prueba de consentimiento.
- Deshabilitar el login password si aparece una identidad no aprobada.

### Consecuencias

- La frontera de confianza de proveedor y la aprobación de acceso de SkillBase quedan separadas; tanto ingreso normal como callback de asociación deben validar método de sesión y estado interno.
- Las migraciones 0012–0015, hook/provider config y secret Auth se desplegaron mediante PR 126; el release pasó CI/deploy. Google OAuth real y SMTP/entrega recovery no se probaron. El fallback de recuperación email no se debe describir como operativo.
- Este ADR implementa el requerimiento de asociación explícita a nivel de la aplicación y no reemplaza ni debilita ADR-023 sobre no fusionar usuarios internos automáticamente.

---

## ADR-025 — CONTRATO DE EVALUACIÓN Y PRECISIÓN DE NOTAS

**Fecha:** 2026-10-06

**Estado:** Accepted — backend/UI implementados y liberados mediante PR 235

### Contexto

Fase 7 necesita componentes ponderados y notas, preservando resultados
reproducibles en PostgreSQL y haciendo inequívoco cuándo una evaluación está
incompleta. También debe separar la calificación de la elegibilidad por
asistencia, del cierre administrativo de Fase 8 y de certificados de Fase 9.

### Decisión

- Definir componentes con nombre libre por curso y pesos decimales exactos cuya
  suma sea exactamente 100 %. Derivar modalidad como `THEORY`, `PRACTICAL` o
  mixta según los componentes.
- Aceptar notas de 0–100 con hasta dos decimales. No usar punto flotante ni
  redondear cálculos intermedios; redondear la nota final a dos decimales y
  compararla contra `minimum_grade` usando el mismo valor que se muestra. 70 es
  el default provisional de esa configuración, no un valor universal fijo.
- Congelar componentes/pesos al persistir la primera nota del curso, incluido
  un 0; correcciones de notas deben ser auditables. No se aprueba cambiar pesos
  tras ese punto.
- Tratar como incompleta/pendiente cualquier evaluación con nota requerida
  ausente. No hay exención: la evaluación incompleta equivale explícitamente a
  0 para decisión académica y debe distinguirse de una nota completa igual a 0.
- Admitir notas solo para `INSCRITO`; Instructor se limita a curso propio desde
  su inicio oficial, mientras `ADMIN` puede gestionar cualquier curso con sus
  roles actuales. La inelegibilidad por asistencia no bloquea la calificación.
- Limitar Fase 7 a evaluación/notas, sin cierre/reapertura o planilla de Fase 8
  ni emisión/certificados de Fase 9.

### Alternativas

- Calcular con `float` o aplicar tolerancia a la suma de pesos.
- Redondear cada subtotal antes de sumar.
- Permitir cambiar pesos después de comenzar a calificar.
- Tratar notas faltantes como exención o confundirlas con notas completas cero.
- Hacer que la elegibilidad por asistencia bloquee el ingreso de notas.

### Consecuencias

- Persistencia, validadores y cálculos deben usar representación decimal exacta
  en base de datos y aplicación; UI y servidor muestran/comparan el mismo valor
  final redondeado.
- El primer guardado de una nota incluso en cero es una frontera de inmutabilidad
  del esquema, así que su aplicación debe ser atómica ante concurrencia.
- Las correcciones de notas requieren trazabilidad; pesos y componentes no
  podrán ajustarse retrospectivamente dentro de Fase 7.
- Contrato y casos límite detallados en
  [`docs/EVALUATIONS_CONTRACT.md`](EVALUATIONS_CONTRACT.md). PRs 230/232
  integraron backend/UI y PR 235 liberó el módulo acotado. Migration 0020 se
  aplicó idempotentemente al Supabase local canónico y a cloud por el pipeline;
  las tablas/permisos cloud se confirmaron mediante consulta read-only, sin hash
  pre/post completo de filas existentes. Fase 8/9 siguen siendo milestones
  separados.
