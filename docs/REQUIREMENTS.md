# REQUIREMENTS

## ALCANCE

Sistema web para gestionar cursos de formación continua desde publicación hasta certificación.

No es un LMS.

## ACTORES

### Administrador

Gestiona el ciclo operativo completo.

### Instructor

Consulta su perfil profesional y sus cursos asignados. La gestión académica de asistencia/sesiones pertenece a Fase 6.

### Participante

Interactúa principalmente mediante flujos públicos o administrativos.

### Usuario externo

Verifica certificados.

## CURSOS

### RF-CUR-001

El administrador debe poder crear un curso.

### RF-CUR-002

Un curso debe poder registrar al menos:

- nombre;
- descripción;
- nivel;
- un tipo/formato de curso administrado;
- horario;
- condiciones;
- fechas;
- estado.

### RF-CUR-003

El administrador debe poder publicar y retirar un curso.

### RF-CUR-004

Los cursos publicados deben aparecer automáticamente en el catálogo público.

Está implementado mediante catálogo y detalle públicos SSR. Solo aparecen cursos `PUBLISHED`; los no públicos no se distinguen de slugs inexistentes en detalle.

### RF-CUR-005

Los niveles iniciales son:

- Básico.
- Medio.
- Avanzado.

### Reglas concretadas en Fase 2A

- El curso nace como `DRAFT`, puede publicarse, retirarse de `PUBLISHED` a `DRAFT` y archivarse sin borrado físico. `ARCHIVED` es terminal en esta fase.
- El slug se deriva del nombre al crear, es único y permanece inmutable aunque cambie el nombre.
- Un curso publicado puede editar su información pública y precios; cada cambio queda auditado.
- Nombre, descripción, nivel, formato, condiciones, fechas públicas y nota mínima son obligatorios. El horario diario pertenece a cada grupo; el formato aporta duración positiva y precios `STUDENT`/`EXTERNAL` en `BOB`.
- La nota mínima admite enteros de 0 a 100. No se configura aún asistencia mínima ni se calculan resultados académicos.
- La ventana de preinscripción es opcional como conjunto: apertura y último día deben estar ambos ausentes o ambos presentes. En cursos nuevos se ingresan fechas civiles de Bolivia (`YYYY-MM-DD`): abre a las 00:00 del día de apertura y permanece abierta durante todo el último día, cerrando a las 00:00 del día siguiente (límite exclusivo). El último día debe ser anterior al inicio de clases. Los cursos heredados conservan sus instantes precisos de apertura y cierre al editarse.
- Los campos de fecha/hora se interpretan como tiempo civil de Bolivia (`America/La_Paz`, UTC-04 sin DST). Las fechas comunes de cursos nuevos se ingresan como fecha civil (`YYYY-MM-DD`); los campos heredados de fecha/hora conservan la hora visible al reeditar.
- Una edición debe incluir la revisión observada del curso. Si otra operación cambió el agregado, el guardado obsoleto se rechaza sin sobrescribir y permite revisar/reintentar.
- Todo monto se expresa como decimal de dos posiciones en moneda `BOB`; no se usan valores de punto flotante.
- Solo un usuario interno activo con rol `ADMIN` puede crear, modificar o cambiar el estado de un curso.
- La publicación exige un formato activo/revisión válida con exactamente los precios `STUDENT` y `EXTERNAL` aplicables, ambos en `BOB`.
- El contrato público devuelve exclusivamente cursos `PUBLISHED` y no expone identificadores, estado, nota mínima ni timestamps administrativos; catálogo y detalle están implementados por SSR.
- El campo `schedule` sigue siendo texto informativo de compatibilidad. Los cursos nuevos indican que el horario depende del grupo, y los cursos anteriores conservan su horario textual o el plan horario histórico. Todavía no hay sesiones operativas de grupos.
- El contenido opcional Markdown se presenta sin HTML crudo y se filtran protocolos de enlaces no permitidos. `instructorName` conserva nombres libres históricos; la asignación real usa el perfil interno y no se backfillea automáticamente desde ese texto.
- Se puede seleccionar como destacado, con máximo uno entre cursos publicados; si no se designa uno, landing y catálogo usan fallback determinista.

### Instructor y asignación (Fase 4, liberado mediante PR 126)

- Administración crea un perfil de instructor con nombre, apellido y email obligatorios; el email se normaliza antes de persistirse y el teléfono es opcional. En presentación pública se usa únicamente el nombre completo; no se recopila ni publica descripción.
- Cada instructor interno tiene rol `INSTRUCTOR` y una cuenta Supabase Auth aprovisionada por el ADMIN desde servidor. El ADMIN establece la contraseña inicial; no se envía invitación ni se fuerza un paso adicional de cambio de contraseña. El instructor puede cambiarla desde su perfil opcionalmente.
- Email/password complementa Google para cuentas internas. Un instructor autenticado puede enlazar Google explícitamente a la misma cuenta solo tras verificar el correo y confirmar coincidencia normalizada. No se permite fusión automática. ADMIN existentes conservan Google y pueden añadir contraseña; esta fase no añade gestión de creación de ADMIN.
- Instructor solo puede consultar/editar su propio perfil y consultar los cursos que tiene asignados. Formatos, interesados, participantes, usuarios y configuración quedan fuera de su autorización en Fase 4. Sesiones y asistencia permanecen en Fase 6.
- Cada curso publicado tiene exactamente un instructor asignado; todos los grupos heredan esa asignación. Un `DRAFT` puede quedar sin asignar. El texto libre `instructorName` deja de ser la fuente de asignación real.
- Corrección implementada/validada en la rama fuente e integrada mediante PR 134 (release no acreditado): un curso `PUBLISHED` debe conservar al menos un grupo activo además del instructor activo. Un `DRAFT` puede permanecer sin instructor; «Sin asignar…» es placeholder deshabilitado y editar otro campo no obliga a asignarlo ni permite seleccionarlo.
- Cambiar instructor en curso publicado se permite antes del inicio oficial; desde el inicio queda bloqueado. Las validaciones se hacen en servidor y se mantienen las reglas actuales de retiro/archivo e historial.
- Una asignación no puede hacer que un instructor esté en dos cursos cuyos calendarios L–V coincidan en fecha y horario civil de Bolivia (`America/La_Paz`). Se usan intervalos semiabiertos, por lo que turnos contiguos no se consideran conflicto. Mutaciones concurrentes de asignación, fecha de curso, horario/grupo, estado o publicación deben serializar conflicto y escritura para evitar carreras.
- El release PR 126 no incorporó desactivación. La corrección pasó el full gate local en `8735d676fe0d96e7230b4636efa8cb51045d1eca` y se integró mediante PR 136 (`8cdb38f`); 0016 y smoke local están verificados. Producción permanece en PR 126. Instructor con historial asignado no se elimina físicamente y solo se activa/desactiva si no tiene cursos no archivados asignados; se muestran cursos y se requiere resolver asignaciones. Se permite desactivar si todas las asignaciones son a cursos archivados. Sin historial, eliminación solo con rol único `INSTRUCTOR` y sin dependencias, con Auth eliminado consistentemente. Desactivado pierde acceso en rutas/acciones server-side aun con sesión vigente. Ver `docs/AUTHENTICATION.md`.
- Incluir eventos de auditoría para creación/actualización de asignación y mutaciones de cuenta, sin credenciales. Auditoría como UI/reportes no es parte de este flujo.

La migración 0014 agrega perfiles y asignación preservando cursos legados sin mapear automáticamente `instructorName`; las migraciones 0012–0015 se aplicaron a local y cloud mediante PR 126. La implementación incluye CRUD ADMIN de perfiles/asignaciones, edición propia de datos profesionales (correo no editable) y consulta instructor de `/app/mis-cursos` filtrada por ownership server-side; los flujos aprobados se liberaron a producción. Se auditan `INSTRUCTOR_CREATED`, `INSTRUCTOR_UPDATED`, cambios de asignación y `PASSWORD_CHANGED`, sin credenciales/tokens. El evento de password se escribe después de éxito Auth; si PostgreSQL falla, el cambio no se revierte y se registra un fallback sanitizado. La baja no tenía política ni endpoint/UI en dicho release; la política correctiva aprobada y su implementación en la rama fuente se describen arriba.

Las correcciones aprobadas de Fase 4 están implementadas, superaron la validación local completa en `8735d676fe0d96e7230b4636efa8cb51045d1eca` (base `ddd0f3de`; 178 unit, 98 integration, 120/120 E2E) y se integraron mediante PR 136 (`8cdb38f`). 0016 y smoke local se verificaron después de PR 135; producción no se actualizó y sigue correspondiendo a PR 126.

### Reglas implementadas de formatos e imágenes

- Administración puede crear y activar/desactivar formatos tarifarios, cada uno con duración y valores `STUDENT`/`EXTERNAL` en `BOB`.
- Las revisiones del formato son inmutables. Un curso referencia una única revisión; cambios de formato desplazan cursos `DRAFT` a la vigente y preservan la revisión de cursos `PUBLISHED` y `ARCHIVED`.
- La administración permite crear formatos en una página dedicada y abrir el detalle desde su tarjeta. Nombre, duración y cada precio se guardan como cambios individuales; una escritura con revisión obsoleta se rechaza para evitar sobrescribir datos concurrentes.
- Un formato asociado a uno o más cursos no se puede eliminar; debe desactivarse para impedir nuevas selecciones y conservar las referencias históricas. Solo un formato todavía no usado puede eliminarse.
- La migración asigna a cursos existentes formatos/revisiones construidos con sus valores históricos exactos.
- Los formatos de 20 h (80/100 Bs) y 30 h (120/150 Bs) los crea el seed local como defaults editables de desarrollo, no como precios universales.
- Cada nueva revisión de formato registra también la duración de sesión en minutos. Los ejemplos 20 h/90 min y 30 h/150 min se configuran explícitamente; revisiones históricas sin esa información permanecen sin resolver, salvo coincidencias exactas con los ejemplos conocidos.
- Los cursos nuevos con formato configurado se programan de lunes a viernes: se indica la fecha civil inicial de Bolivia y se calcula la última fecha a partir de sesiones completas, redondeando la cantidad al entero más cercano. Así, 20 h/90 min implica 13 sesiones y 19,5 h planificadas; 30 h/150 min implica 12 sesiones y 30 h. El curso comparte fechas y días; cada grupo define su hora de inicio y el fin diario se deriva de la duración de sesión. La fecha final es calculada y no editable. Los horarios de grupos del mismo curso no se solapan (los turnos contiguos sí se permiten), y la interfaz previsualiza el fin según el formato. No se desplazan automáticamente las fechas por feriados: su calendario y las recuperaciones quedan pendientes del calendario operativo de grupos.
- El inicio de un curso nuevo planificado no puede ser pasado ni caer en fin de semana, el fin se valida contra el plan y la preinscripción opcional debe cerrar antes del inicio de clases. Las ofertas históricas sin planificación estructurada mantienen sus fechas y horario informativo originales.
- En cursos nuevos con planificación L–V, la fecha inicial debe ser futura y hábil; las fechas/horas de calendario heredadas impiden fines de semana y fechas pasadas cuando corresponde. La preinscripción exige apertura y cierre juntos, con cierre posterior a apertura y ambos previos al inicio del curso; al editar ofertas históricas se conservan las horas civiles.
- El upload de artwork opcional se limita a administradores autorizados, y al faltar imagen se conserva fallback gráfico Cota Activa.
- Con JavaScript, el administrador recorta la foto en una ventana emergente: el área que quedará visible se muestra normal y el exterior oscurecido. «Guardar recorte» prepara una vista previa WebP; solo al guardar el formulario se sube mediante el endpoint autorizado. Al crear se persiste primero el borrador y después se asocia la imagen con revisión optimista; al editar, la carga y asociación ocurren al pulsar «Guardar cambios». Si falla el proceso después de crear el borrador se puede reintentar sin duplicarlo o abrir su edición. Sin JavaScript se puede crear sin foto.
- Antes de Fase 5 no existía descuento auxiliar implementado. El contrato aprobado para Fase 5 aplica 50 % inmediato sobre la tarifa `STUDENT` al participante `AUXILIARY` seleccionado manualmente por ADMIN; configuración global por defecto y alcance están detallados abajo.

## PREINSCRIPCIÓN

En Fase 3, el término funcional es **registro de interesado**: una manifestación de interés sin pago, asignación de cupo ni preinscripción presencial. No debe presentarse como preinscripción pagada ni como aceptación. La **preinscripción presencial**, que registra pago parcial o total y ocupa cupo, pertenece a Fase 5; puede iniciarse directamente o usar un interesado como prellenado editable. No se establece aquí cuándo o si pasa a inscripción definitiva. Cambios de grupo y devoluciones también pertenecen a Fase 5.

### RF-PRE-001

Una persona debe poder dejar sus datos como interesada desde el detalle público de un curso publicado. No se modifica ni se añade información a la landing para este flujo.

Datos obligatorios: nombre, apellidos y email. Teléfono y preferencia de grupo son opcionales. Se permite una solicitud por curso y email normalizado. La disponibilidad comienza al publicarse el curso y termina con el cierre presencial configurado cuando existe una ventana; si no existe ventana, termina al inicio oficial del curso. El servidor valida disponibilidad y duplicados, y no acepta solicitudes para cursos retirados o archivados.

Al recibir un duplicado, la respuesta pública conserva el mismo resultado neutro de éxito que una solicitud nueva; nunca confirma si el email ya está registrado. Integridad y detección de duplicados siguen siendo autoritativas en servidor.

### RF-PRE-002

Administración debe poder consultar interesados y cancelar/reactivar registros, conservando su historial. Los estados son `ACTIVE` y `CANCELLED`.

### RF-PRE-003

El sistema debe mostrar métricas de interesados `ACTIVE` por curso y por preferencia de grupo. La preferencia se cuenta aparte de la asignación efectiva a un grupo; no expresa plazas disponibles u ocupadas (ADR-021).

### RF-PRE-004

Un registro de interesado no equivale a preinscripción presencial pagada, no ocupa cupo y no constituye aceptación de la persona. Cualquier preinscripción posterior es una operación administrativa independiente conforme a las reglas de Fase 5; no es transición automática desde el formulario público.

## GRUPOS

### RF-GRP-001

Administración debe poder crear grupos a partir de la demanda.

### RF-GRP-002

Cada grupo debe permitir configurar:

- capacidad máxima positiva propia (sin mínimo automático);
- hora de inicio de clase y fin calculado según la revisión del formato;
- fechas y días L–V heredados del curso (en borrador o publicado);
- estado.

El instructor sigue siendo un dato global del curso hasta que exista asignación real de usuarios instructores. Solo los grupos **del mismo curso** no pueden solapar horarios; los extremos contiguos son válidos. El cupo de un grupo no impide que administración decida impartirlo con menos participantes.

Durante el alta pueden configurarse cero o varios grupos en un mismo formulario. Primero se guarda el borrador y luego se crean sus grupos; ante un fallo parcial se muestra el enlace al borrador y se reintentan únicamente los pasos pendientes. También pueden añadirse grupos en la pestaña «Grupos» mientras el curso sea `DRAFT` o `PUBLISHED`, nunca `ARCHIVED`, siempre que disponga de calendario L–V y duración de sesión conocida. La existencia de grupos fija las fechas del curso y su revisión de formato. Un grupo que nunca fue publicado puede eliminarse; después de su primera publicación se conserva y solo puede desactivarse/cancelarse o reactivarse.

Un curso `PUBLISHED` debe tener como mínimo un grupo activo; no se puede desactivar el último grupo activo mientras el curso siga publicado. Retirar editorialmente el curso sí se permite y no equivale a desactivar grupo.

### RF-GRP-003

Administración puede cancelar un grupo por demanda insuficiente sin borrarlo ni perder su historial; la cantidad de inscritos no determina automáticamente el cierre.

### RF-GRP-004

Puede crearse un grupo adicional cuando exista demanda suficiente.

La capacidad se define por grupo; 15 estudiantes no es un mínimo ni un valor obligatorio.

### RF-GRP-005

Las sesiones afectadas por feriados deben poder reprogramarse.

La reprogramación de sesiones individuales, las preinscripciones/inscripciones y los cambios de grupo de participantes quedan pendientes de sus módulos propios. No se crean ni asignan estudiantes automáticamente al abrir un segundo grupo.

## PREINSCRIPCIÓN PRESENCIAL E INSCRIPCIÓN DEFINITIVA

La preinscripción presencial de Fase 5 ocupa cupo y puede registrar pagos parciales/totales; también puede ser gratuita si un descuento aprobado reduce el precio final a cero. Permanece `PREINSCRITO` hasta la fecha de inicio oficial; desde el inicio pasa a `INSCRITO` si el saldo está cubierto. La condición `INSCRITO` del proceso administrativo no significa culminación académica ni habilita módulos posteriores por sí sola.

### Reglas confirmadas para Fase 5 (release de producción; ver estado)

- La persona participante es ficha global ADMIN, sin cuenta de acceso, con CI como identidad única normalizada conservadoramente (trim/espacios/case, preserva ceros iniciales, letras y sufijos; no cast numérico, formato/checksum nacional ni escaneo documental). Nombre/apellidos y email son obligatorios; teléfono opcional. Máximo una preinscripción vigente por persona/curso; puede participar en varios cursos. CI nunca se publica.
- ADMIN puede registrar directamente o buscar interesados del mismo curso por nombre/correo y prellenar datos editables para completar ficha. El origen se informa readonly y se conserva trazabilidad interna, sin selector de asociación/fusión. Email público no verificado no identifica a Participant ni modifica métricas de interesados.
- Tipos `STUDENT`, `EXTERNAL` y `AUXILIARY` se asignan manualmente por ADMIN. `AUXILIARY` usa tarifa base `STUDENT`; el descuento global configurable va de 0–100 % inclusive (default 50 %), sin requerir evidencia/categoría adicional ni certificado previo. El mínimo global configurable va de 1–100 % (default 25 %). Estos porcentajes se aplican a preinscripciones nuevas, nunca retroactivamente.
- Se guarda snapshot de revisión/precio de tarifa, tipo/base, porcentajes y valores aplicados; editar configuración o precio no recalcula registros ni pagos previos. Montos en `BOB`, centavos exactos/decimal preciso, nunca `float`. Para precio final positivo, el primer pago debe alcanzar el mínimo = ceil al centavo de precio final × porcentaje mínimo; abonos posteriores no pueden superar saldo. Si `AUXILIARY` tiene descuento 100 % y total final cero, puede registrarse gratis: no se crea movimiento de pago de valor cero y el mínimo se exime solo en este caso gratuito. Cualquier pago registrado representa efectivo efectivamente recibido; no simular abono para completar el mínimo.
- Pagos manuales en efectivo, con abonos múltiples; no hay pasarela, upload de evidencia, emisión de recibos ni boleta/valorado automático. No se admiten montos negativos o sobrepago. Fecha efectiva de pago en `America/La_Paz`, default hoy; permite fechas pasadas, prohíbe futuras. Guardar aparte timestamp/actor que registraron el movimiento. Devolución es movimiento auditable, no ejecución de transferencia bancaria; suma reembolsada no supera pagos registrados, por lo que una preinscripción gratuita no genera devolución monetaria.
- Registro ordinario en curso `PUBLISHED`, grupo `PLANNED` con instructor `ACTIVE` y cupo, hasta cierre inclusivo de ventana o inicio oficial si no hay ventana. Excepción ADMIN limitada al primer día civil del curso, solo total cubierto (si el total es cero por gratuidad, sin movimiento de pago) y destino/cupo elegibles; dejar auditoría, no aceptar después de ese día por esa excepción.
- Estado `PREINSCRITO` hasta el inicio aunque haya pagado todo. Al inicio, si saldo está cubierto, pasa a `INSCRITO`. Si queda saldo, mantiene `PREINSCRITO` durante el primer día y al terminar ese día pasa a `SALDOVENCIDO`; no cancelación, liberación de cupo ni devolución automática. ADMIN resuelve. Estos estados no habilitan sesiones/asistencia/evaluación.
- Cancelación voluntaria permite reembolso total de lo pagado solo hasta cutoff inclusivo. Cancelar un grupo exige registrar reembolso total de todo pago asociado sin límite por cutoff. Preservar persona, registro y movimientos; reembolso no representa liquidación bancaria.
- Cambio de grupo solo dentro del mismo curso, hasta cutoff, con destino activo y cupo; sin transferir entre cursos ni recalcular precio snapshot porque los grupos del curso comparten revisión/tarifa. Garantizar consistencia de cupos entre origen y destino.
- Solo `ADMIN` crea/cambia participantes, preinscripciones, pagos, configuración y devoluciones. Instructor lee únicamente cursos/grupos propios y roster desde inicio oficial, solo nombre/apellidos; sin CI/email/finanzas ni exportación. Listados CSV/PDF solo ADMIN, neutralizan formula injection, se limitan a 1000 filas y no son recibos/boletas. Sesiones, asistencia, notas y certificados no se adelantan (Fase 6+).

### Límite de definición

El alcance funcional está confirmado, incluido el registro gratuito por descuento AUXILIARY del 100 %: no se registra pago cero y el mínimo se exime solo si el total final exacto es cero.

Estado de implementación: modelo/migración 0017, dominio/repositorio transaccional, settings, generadores CSV/PDF y rutas/UI se integraron por PRs 173–180. Fase 5 se liberó en producción como `2e0eecb` (cloud ledger 18); el gate local reportado pasó 303 unit, 125 integration y 125/125 E2E. Las correcciones post-release de experiencia administrativa son trabajo pendiente separado, y sesiones/asistencia aún no están implementadas; ver `docs/PLAN.md`.

### RF-ENR-001

Administración debe poder registrar la preinscripción presencial y resolver estados/pagos conforme a las reglas aprobadas de esta sección.

### RF-ENR-002

La inscripción debe registrar el tipo de participante.

### RF-ENR-003

Debe registrarse el precio efectivamente aplicado.

### RF-ENR-004

Debe permitir registrar descuento.

### RF-ENR-005

Debe permitir revertir o cancelar una inscripción antes del cierre correspondiente.

### RF-ENR-006

Debe permitir registrar una devolución cuando el grupo se cancela.

### RF-ENR-007

Debe permitir asociar información de boleta o valorado cuando sea requerida.

## PRECIOS

Valores iniciales conocidos:

### Curso de 30 horas

- Estudiante: 120 Bs.
- Externo: 150 Bs.

### Curso de 20 horas

- Estudiante: 80 Bs.
- Externo: 100 Bs.

Estos valores no deben hardcodearse como reglas universales.

Estos importes se usan como valores iniciales de ejemplo en el seed de desarrollo y no deben hardcodearse como reglas universales. En el modelo implementado forman parte de revisiones de formatos, no de valores editables directamente en cada curso.

## DESCUENTOS

### RN-DIS-001

Para Fase 5, ADMIN selecciona manualmente el tipo `AUXILIARY` y se aplica de inmediato el porcentaje auxiliar global configurado (default 50 %) sobre la tarifa `STUDENT`. No se solicita evidencia digital ni se define una taxonomía adicional de categorías. Esta regla se aplica al registro administrativo, no se publica como tercer precio en el catálogo.

### RN-DIS-002

El descuento auxiliar descrito arriba no espera ni depende de obtener un certificado de finalización. No se automatiza un beneficio distinto posterior al certificado.

## SESIONES (Fase 6, alcance aprobado; aún no implementado)

### RF-SES-001

Cada grupo debe tener un calendario de sesiones generado a partir de la duración por sesión y el calendario del curso. Generar sesiones no equivale a haber verificado asistencia histórica.

### RF-SES-002

Una sesión debe registrar:

- fecha;
- hora;
- estado (incluye sesiones canceladas conservadas en cronología);
- reemplazo si corresponde, conservando vínculo al encuentro original.

### Referencias iniciales

30 horas:

- sesiones aproximadas de 2,5 horas.

20 horas:

- sesiones aproximadas de 1,5 horas.

No asumir que estos valores nunca cambiarán. La generación toma la revisión de formato aplicable y no reescribe silenciosamente el calendario ya creado.

## ASISTENCIA (Fase 6, alcance aprobado; aún no implementado)

### RF-ATT-001

El instructor debe poder registrar asistencia por sesión.

### RF-ATT-002

Debe registrarse asistencia del instructor cuando corresponda.

Fase 6 no calcula ni presenta porcentaje de asistencia ni aplica un gate porcentual. Cualquier requerimiento porcentual queda fuera de este milestone.

### RF-ATT-004

ADMIN configura el número N de ausencias consecutivas (inicialmente 3). Se advierte al llegar a N y se pierde elegibilidad académica al superar N. Una ausencia justificada cuenta para asistencia e interrumpe la racha. No se expulsa ni se cancela automáticamente una plaza, ni se inicia devolución.

### RF-ATT-005

La evidencia de presencia puede derivarse operativamente de:

- lista;
- trabajo/práctica;
- examen diario teórico/práctico.

El sistema registra el resultado, no automatiza esos mecanismos de evidencia. Los estados son `Presente`, `Ausente` y `Justificada`; no existe tardanza. Solo se registran participantes `INSCRITO` del grupo.

### Reglas de calendario, acceso y edición

- Las sesiones generadas de lunes a viernes incluyen fechas pasadas; la asistencia inicial de esas sesiones queda pendiente de revisión explícita ADMIN y no se convierte retroactivamente en ausencia.
- ADMIN puede registrar feriados, cancelar sesiones sin borrarlas y añadir reemplazos. El reemplazo conserva duración y cronología; puede ocurrir el mismo día a una hora anterior o en otro día, incluido fin de semana, sujeto a evitar conflictos de instructor y grupo.
- Instructor solo opera sus propios grupos y puede modificar asistencia durante el día civil de Bolivia de la sesión. ADMIN puede consultar/registrar asistencia de participantes e instructor y corregir posteriormente; las correcciones administrativas quedan auditadas.
- Durante el día una marca faltante permanece pendiente; al finalizar el día se deriva como ausente, sin requerir un proceso global que inserte registros irreversibles. Sesiones canceladas no participan en asistencia ni en rachas.
- La configuración de esta fase se limita a N para rachas consecutivas; no define un porcentaje mínimo de asistencia. El bloqueo de elegibilidad académica podrá alimentar certificación futura (Fase 9), pero no hay emisión de certificados en Fase 6.

## EVALUACIÓN

### RF-EVA-001

El instructor debe poder configurar componentes de evaluación.

Ejemplos:

- actividades;
- parciales;
- examen teórico;
- examen práctico.

### RF-EVA-002

Cada componente debe permitir peso.

### RF-EVA-003

La suma de pesos debe ser 100 %.

### RF-EVA-004

El instructor debe poder registrar notas.

### RF-EVA-005

El sistema debe calcular nota final.

### RN-EVA-001

Referencia inicial de aprobación:

- nota final >= 70/100.

Debe ser configurable.

## CERTIFICACIÓN

### RF-CER-001

El sistema debe determinar elegibilidad según nota y asistencia.

### RF-CER-002

El sistema debe generar certificado digital.

### RF-CER-003

Debe permitir imprimir certificado.

### RF-CER-004

Debe permitir cargar certificado firmado.

### RF-CER-005

Debe generar credential ID público.

### RF-CER-006

Debe generar QR.

### RF-CER-007

Debe existir una URL pública de verificación.

### RF-CER-008

Debe permitir revocar.

### RF-CER-009

Debe permitir descargar el PDF final cuando corresponda.

### RF-CER-010

Debe permitir utilizar URL e identificador como credencial para servicios externos como LinkedIn.

## CIERRE

### RF-CLO-001

Administración debe poder cerrar un grupo.

### RF-CLO-002

Debe permitir generar o registrar planilla de calificaciones.

### RF-CLO-003

Debe permitir registrar informe de finalización.

### RF-CLO-004

Debe soportar el proceso administrativo de firmas.

Referencia operativa conocida:

- finalizado el curso;
- jefatura recibe planilla;
- se procesa informe;
- se tramitan firmas;
- certificados pueden entregarse posteriormente.

## PUBLICACIÓN

Los cursos pueden difundirse fuera del sistema mediante:

- redes sociales;
- vitrina del departamento;
- canal de WhatsApp.

El sistema no necesita automatizar esos canales en MVP.

La landing pública debe ser la fuente web oficial para información vigente.

La jerarquía pública aprobada es:

- las tarjetas de landing y catálogo no muestran rangos de fechas y conservan el nivel y la duración total en horas;
- las tarjetas no muestran los dos precios detallados ni el horario detallado;
- `/cursos/[slug]` muestra inicio, fin y apertura/cierre de preinscripción como fechas civiles de Bolivia sin hora, además de condiciones y precios diferenciados; no muestra el horario informativo legado. Los horarios de grupos se consultan únicamente en administración.

## DOCUMENTOS

El participante puede entregar fotocopia de CI hasta el primer día según el proceso actual.

Antes de implementar almacenamiento digital de CI debe confirmarse si realmente será necesario.

No almacenar documentos personales únicamente porque el proceso físico los utiliza.

## REQUISITOS NO FUNCIONALES

### RNF-001

Responsive.

### RNF-002

Accesibilidad.

### RNF-003

Autorización server-side.

### RNF-004

Trazabilidad de operaciones sensibles.

### RNF-005

Entorno reproducible.

### RNF-006

CI antes de producción.

### RNF-007

Verificación pública segura de certificados.

### RNF-008

Protección de datos personales.

## PUNTOS PENDIENTES DE CONFIRMACIÓN

- requisitos académicos adicionales a la política de ausencias consecutivas aprobada para Fase 6, si se acuerdan para fases posteriores;
- cuándo se consolida el descuento de auxiliares;
- lista definitiva de auxiliares beneficiarios;
- tipos definitivos de certificado;
- firmas requeridas;
- datos obligatorios de boleta;
- reportes administrativos exactos.
