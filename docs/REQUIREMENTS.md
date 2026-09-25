# REQUIREMENTS

## ALCANCE

Sistema web para gestionar cursos de formación continua desde publicación hasta certificación.

No es un LMS.

## ACTORES

### Administrador

Gestiona el ciclo operativo completo.

### Instructor

Gestiona aspectos académicos de grupos asignados.

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
- Nombre, descripción, nivel, formato, horario informativo, condiciones, fechas públicas y nota mínima son obligatorios. El formato aporta duración positiva y precios `STUDENT`/`EXTERNAL` en `BOB`.
- La nota mínima admite enteros de 0 a 100. No se configura aún asistencia mínima ni se calculan resultados académicos.
- La ventana de preinscripción es opcional como conjunto: apertura y cierre deben estar ambos ausentes o ambos presentes, con apertura anterior al cierre. Su disponibilidad es derivada.
- Los campos `datetime-local` se interpretan como tiempo civil de Bolivia (`America/La_Paz`, UTC-04 sin DST), validan exactamente `YYYY-MM-DDTHH:mm` y conservan la misma hora visible después de persistir y reeditar.
- Una edición debe incluir la revisión observada del curso. Si otra operación cambió el agregado, el guardado obsoleto se rechaza sin sobrescribir y permite revisar/reintentar.
- Todo monto se expresa como decimal de dos posiciones en moneda `BOB`; no se usan valores de punto flotante.
- Solo un usuario interno activo con rol `ADMIN` puede crear, modificar o cambiar el estado de un curso.
- La publicación exige un formato activo/revisión válida con exactamente los precios `STUDENT` y `EXTERNAL` aplicables, ambos en `BOB`.
- El contrato público devuelve exclusivamente cursos `PUBLISHED` y no expone identificadores, estado, nota mínima ni timestamps administrativos; catálogo y detalle están implementados por SSR.
- El campo `schedule` sigue siendo texto informativo. El formulario ofrece un constructor de horario por días/horas, pero no persiste calendario estructurado ni reemplaza la futura planificación de sesiones.
- El contenido opcional Markdown se presenta sin HTML crudo y se filtran protocolos de enlaces no permitidos. Instructor se almacena como texto provisional, no como asignación de identidad.
- Se puede seleccionar como destacado, con máximo uno entre cursos publicados; si no se designa uno, landing y catálogo usan fallback determinista.

### Reglas implementadas de formatos e imágenes

- Administración puede crear y activar/desactivar formatos tarifarios, cada uno con duración y valores `STUDENT`/`EXTERNAL` en `BOB`.
- Las revisiones del formato son inmutables. Un curso referencia una única revisión; cambios de formato desplazan cursos `DRAFT` a la vigente y preservan la revisión de cursos `PUBLISHED` y `ARCHIVED`.
- La administración permite crear formatos en una página dedicada y abrir el detalle desde su tarjeta. Nombre, duración y cada precio se guardan como cambios individuales; una escritura con revisión obsoleta se rechaza para evitar sobrescribir datos concurrentes.
- Un formato asociado a uno o más cursos no se puede eliminar; debe desactivarse para impedir nuevas selecciones y conservar las referencias históricas. Solo un formato todavía no usado puede eliminarse.
- La migración asigna a cursos existentes formatos/revisiones construidos con sus valores históricos exactos.
- Los formatos de 20 h (80/100 Bs) y 30 h (120/150 Bs) los crea el seed local como defaults editables de desarrollo, no como precios universales.
- El upload de artwork opcional se limita a administradores autorizados, y al faltar imagen se conserva fallback gráfico Cota Activa.
- Con JavaScript, el administrador puede seleccionar y recortar artwork en el alta. Al crear se persiste primero el borrador, luego se sube WebP mediante el endpoint autorizado y se asocia con una edición que usa revisión optimista. Si falla la carga, el borrador permanece y se ofrece reintentar o abrir su edición. Sin JavaScript se puede crear sin foto y añadirla después desde edición.
- El descuento del 50 % para auxiliares no está implementado: no existe elegibilidad validada ni tercer precio; permanece para fases de inscripción/descuentos posteriores.

## PREINSCRIPCIÓN

### RF-PRE-001

Una persona debe poder preinscribirse a un curso publicado cuando la preinscripción esté habilitada.

### RF-PRE-002

Administración debe poder consultar preinscripciones.

### RF-PRE-003

El sistema debe permitir utilizar la preinscripción para estimar demanda.

### RF-PRE-004

Una preinscripción no equivale a inscripción definitiva.

## GRUPOS

### RF-GRP-001

Administración debe poder crear grupos a partir de la demanda.

### RF-GRP-002

Cada grupo debe permitir configurar:

- instructor;
- mínimo;
- máximo si corresponde;
- horario;
- fechas;
- estado.

### RF-GRP-003

Un grupo puede cerrarse si no alcanza el mínimo.

### RF-GRP-004

Puede crearse un grupo adicional cuando exista demanda suficiente.

Referencia inicial conocida: 15 estudiantes.

Este valor debe ser configurable.

### RF-GRP-005

Las sesiones afectadas por feriados deben poder reprogramarse.

## INSCRIPCIÓN

### RF-ENR-001

Administración debe poder convertir preinscripción en inscripción.

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

La regla conocida plantea un descuento del 50 % para auxiliares que resulten elegibles; la elegibilidad y la aplicación todavía no están implementadas.

Casos iniciales mencionados:

- ad-honorem;
- cómputo;
- mantenimiento;
- laboratorio de desarrollo.

La lista definitiva debe mantenerse configurable y confirmarse antes de implementar elegibilidad. No se publica un tercer precio ni se promete el descuento en el catálogo actual.

### RN-DIS-002

El descuento aplica a cursos bajo las condiciones administrativas definidas.

La interpretación exacta de “una vez sacado el certificado de finalización” debe confirmarse antes de automatizar esta regla.

## SESIONES

### RF-SES-001

Cada grupo debe tener sesiones.

### RF-SES-002

Una sesión debe registrar:

- fecha;
- hora;
- estado;
- reemplazo si corresponde.

### Referencias iniciales

30 horas:

- sesiones aproximadas de 2,5 horas.

20 horas:

- sesiones aproximadas de 1,5 horas.

No asumir que estos valores nunca cambiarán.

## ASISTENCIA

### RF-ATT-001

El instructor debe poder registrar asistencia por sesión.

### RF-ATT-002

Debe registrarse asistencia del instructor cuando corresponda.

### RF-ATT-003

El sistema debe calcular porcentaje de asistencia.

### RF-ATT-004

Debe poder detectar tres faltas continuas y aplicar/señalar la política definida.

La naturaleza exacta de la sanción debe confirmarse.

### RF-ATT-005

La evidencia de presencia puede derivarse operativamente de:

- lista;
- trabajo/práctica;
- examen diario teórico/práctico.

El sistema inicialmente registra el resultado de asistencia, no necesariamente automatiza cada mecanismo de evidencia.

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

- las tarjetas de landing muestran disponibilidad, título, descripción breve, inicio/fecha, nivel y duración;
- las tarjetas no muestran los dos precios detallados ni el horario detallado;
- `/cursos/[slug]` contiene el horario exacto, las condiciones y los precios diferenciados.

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

- porcentaje exacto mínimo de asistencia;
- significado definitivo de la regla indicada originalmente como “Asistencia <= 70”;
- sanción exacta por tres faltas continuas;
- cuándo se consolida el descuento de auxiliares;
- lista definitiva de auxiliares beneficiarios;
- tipos definitivos de certificado;
- firmas requeridas;
- datos obligatorios de boleta;
- reportes administrativos exactos.
