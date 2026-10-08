# UI CORRECTIONS CONTRACT

## Estado y alcance

Este documento registra los acuerdos para una pasada de correcciones operativas sobre la aplicación de Fase 8. La implementación UI y runner se integraron en `development` mediante PRs 289/288 y luego se liberaron a `master` como `4e067311` (CI `37828609916`, Vercel `READY`). El release no cambia el requisito de PLAN/APPLY manuales y guards descritos en [`DEMO_SEED.md`](DEMO_SEED.md): el seed local canónico ya se completó y el paso cloud sigue pendiente.

Fase 8 permanece cerrada según el estado registrado en [`PLAN.md`](PLAN.md). Este contrato no la reabre. Fase 9 no se implementa aquí; su alcance fue aprobado posteriormente y se mantiene en [`CERTIFICATES_CONTRACT.md`](CERTIFICATES_CONTRACT.md), con implementación bloqueada hasta el paso cloud F1–F8.

## Reglas transversales de interfaz

- Conservar SSR/POST y la validación, autorización, ownership, concurrencia, idempotencia y guardas del servidor existentes. La UI no amplía permisos ni ventanas operativas.
- Mantener responsive, teclado, foco, labels y componentes/tokens vigentes. No crear un tema visual nuevo ni imponer anchos fijos innecesarios.
- Los errores recuperables permanecen visibles en contexto y los valores/drafts se conservan. Pending no debe destruir el control/layout; bloquear dobles escrituras y protegerse contra respuestas obsoletas donde haya requests concurrentes.
- No duplicar feedback persistente con toast. Los diálogos breves de confirmación deben ofrecer dos acciones de ancho igual (50/50): la acción específica y «Volver». Evitar «Cancelar» como nombre de la segunda opción cuando la acción principal ya se llama «Cancelar»; distinguir claramente la decisión de volver de la operación confirmada.
- No alterar tests para hacer pasar la interfaz. Ajustar únicamente expectativas cuya conducta cambie deliberadamente y probar estados observables; revisar desktop/mobile, accesibilidad y fallos/pending.

## Ajustes de texto, formularios y perfiles

- En configuración, quitar la frase: «Al alcanzar este número se muestra una advertencia; al superarlo se pierde el reconocimiento.» No añadir un copy equivalente en otro lugar de esa vista.
- En el flujo de alta presencial/preinscripción, al completar correctamente el alta mostrar directamente el skeleton del detalle recién creado. No presentar primero un formulario vacío ni un estado de error intermedio. El servidor sigue siendo la fuente del ID/resultado; los errores reales de envío conservan los valores y muestran el feedback habitual.
- Búsqueda de administradores: usar todo el ancho disponible y adaptarlo al viewport.
- Alta de ADMIN: el campo de contraseña inicial ocupa exactamente una mitad de la grilla en desktop, compartiendo fila con nombre/correo según el layout existente; no fijar un ancho en píxeles. En mobile, apilar de forma usable.
- Perfil de ADMIN: nombre con ancho mínimo de media grilla y posibilidad de ocupar el ancho completo según el layout; retirar el ancho hardcodeado. Eliminar la sección duplicada «Perfil personal» sin retirar el campo de nombre que efectivamente permite editar el ADMIN.
- Lifecycle de ADMIN: si la cuenta objetivo es el último ADMIN activo, la acción de desactivar/eliminar se muestra deshabilitada y claramente visible. El guard de servidor y su serialización/concurrencia se mantienen intactos; el estado visual es orientación, no autorización. Si el DTO no expone actualmente la elegibilidad, proyectar el dato necesario sin aflojar el guard ni revelar información ajena.
- Búsqueda de instructores: usar todo el ancho disponible, con adaptación responsive.

## Confirmaciones y navegación de sesiones

- Aplicar el patrón transversal de confirmación a las acciones que requieren confirmación, incluyendo eliminar, desactivar, cancelar un registro, transferencia y acciones equivalentes. Mostrar en la misma fila dos botones 50/50: verbo específico de la acción y «Volver». Conservar permisos, elegibilidad y validación de servidor.
- En evaluaciones, eliminar los enlaces a sesiones individuales presentes en esa vista. Antes de retirar, confirmar exactamente la vista de evaluaciones y los enlaces en ella; no eliminar accesos a asistencia/calendario que estén en otras vistas.
- Calendario/sesiones: conservar «Próximas» como filtro predeterminado inicial. Los únicos filtros de estado iniciales son «Próximas», «Finalizadas» y «Canceladas»; no incluir «En curso» ni «Todas» en la selección inicial.
- Seleccionar una fecha restablece el estado a «Todas» y muestra todas las sesiones de esa fecha, sin filtrar por estado. Mientras haya una fecha seleccionada, «Todas» aparece como opción de estado.
- Si hay una fecha seleccionada y se elige «Próximas», «Finalizadas» o «Canceladas», limpiar la fecha y filtrar ese estado en el calendario general.
- Pulsar «Todas» limpia la fecha y deja el estado en «Todas»; muestra el listado total del calendario, sin restricción por fecha. Al quedar sin fecha, «Todas» deja de estar disponible como opción de estado.

## Evaluaciones y notas

- Presentar la nota final alineada horizontalmente con las notas de componentes y su lápiz de edición; quitar la etiqueta redundante «PENDIENTE» debajo del lápiz. Mantener los indicadores de pendiente existentes en el resto de la UI.
- Colocar la búsqueda de participantes en su propia fila de ancho completo. Quitar el texto «Resultados provisionales».
- No modificar reglas de cálculo, esquema, escritura atómica por fila, estados pendientes, historial ni freeze de Fase 7.

## Asistencia

- Mostrar avisos junto al nombre de la persona y permitir wrapping en mobile sin truncarlos ni separar el aviso de su contexto.
- Alinear título de sesión y fecha/hora·estado en la misma fila cuando haya espacio; conservar la misma familia/tamaño/tono tipográfico y no introducir una nueva negrilla para este ajuste. En pantallas estrechas, reflow sin overflow.
- ADMIN puede editar asistencia cuando lo permiten los permisos actuales; no ampliar la edición a sesiones cerradas ni alterar el guard de cierre o el snapshot inmutable de evidencia oficial.
- Instructor puede editar solo dentro de la ventana legal ya vigente (día civil de Bolivia de la sesión y ownership actual). No ampliarla a sesiones futuras; además el backend debe seguir rechazando que el instructor marque antes del comienzo de la sesión actual.
- Estado inicial sin marca: mostrar el texto del estado y lápiz; no abrir select automáticamente ni guardar automáticamente por render/carga. Al elegir la primera marca, persistir automáticamente y mostrar texto más lápiz.
- Abrir edición mediante lápiz muestra selector y «X» para cancelar. No mostrar botón Guardar; guardar la elección automáticamente. La cancelación descarta el draft. Conservar feedback/error inline, el draft tras error recuperable, pending y protección contra doble escritura/respuestas fuera de orden.
- El badge adicional de solo lectura para INSTRUCTOR se muestra solo en sesiones pasadas readonly, no se duplica junto al editor.
- Sesiones finalizadas permanecen readonly como actualmente: este contrato no cambia permisos de sesiones cerradas ni mutabilidad de snapshots oficiales.

## Resultados académicos

- Ajustar la presentación de resultados para adaptarse a la cantidad de componentes, siguiendo el sistema visual actual, sin un tema o estilo nuevo.
- Con pocos componentes, mostrar nombres de componentes, resumen, resultado final, estado y asistencia sin duplicar los mismos datos en bloques de resumen y detalle.
- Hasta 6 componentes, presentar los datos de forma compacta y legible en la vista. Para 7 o más, recomendación: resumen compacto y una tarjeta de resumen completa, clicable en toda su superficie, que abra un diálogo de detalle accesible y responsive. Esta división por cantidad es una guía aprobada de presentación, no una regla de cálculo.
- La tarjeta completa debe tener semántica y teclado de control accionable; el diálogo debe tener nombre, foco, cierre accesible y contenido usable en mobile. No añadir un botón «Ver detalles» redundante si la tarjeta completa ya abre el detalle.
- Preservar la visibilidad de los componentes donde corresponda y no duplicar la nota/estado/asistencia entre vistas más de lo necesario.
- Mantener privacidad financiera de INSTRUCTOR; los nuevos resúmenes y detalles no deben proyectar saldo, pagos o datos financieros.

## Datos sintéticos de QA y demos

El usuario autorizó explícitamente cargar datos **completamente ficticios** en QA local y producción para probar las correcciones, incluso agregando o eliminando esas filas demo. Esta autorización es excepcional y supersede la restricción anterior que impedía sembrar notas académicas; no autoriza destruir datos legítimos ni borrar indiscriminadamente datos del proyecto.

- Preferir un plan aditivo, idempotente y con namespace/provenance DEMO reconocible. No usar reset general ni credenciales Auth existentes como mecanismo de fixture; no eliminar o reemplazar backups/WIP del owner. Toda operación destructiva, si fuera necesaria, debe estar acotada a datos demo identificados y acordada antes de ejecutarse.
- Preparar cobertura ficticia para preinscripciones/inscripciones, finanzas, asistencia, evaluaciones, cierres/versiones, reaperturas y lifecycle ADMIN: cuentas demo ADMIN unused/used/disabled cuando corresponda; cobertura de las tablas Fase 8 nuevas. No crear dependencias Auth sobre usuarios reales ni enviar correo. Usar identidades y datos sintéticos seguros; no emails reales.
- Crear las evaluaciones/cierres/snapshots oficiales mediante servicios y reglas de dominio reales, con actor/rol apropiado, auditoría/outbox y guards intactos. No insertar snapshots oficiales directamente ni eludir inmutabilidad/validaciones con SQL ad hoc. Los datos demo deben quedar identificados como demo y no presentarse como historia académica real.
- La decisión exacta sobre pesos Fase 7 para cada seed de evaluación queda para el owner del plan de seed; utilizar el esquema real y suma/precisión válidas, no inventar una regla académica.
- La QA de datos productivos solo se ejecuta **después** de que todas las correcciones estén integradas a `master` mediante el release aprobado. No sembrar Fase 9 antes de su implementación/autorización. Las cinco tablas Fase 8 estaban vacías en el snapshot de release; cualquier demo académico posterior es carga nueva autorizada, no parte del release anterior.
- Separar evidencia de fixtures y de datos preexistentes. Antes/después registrar conteos/identificadores y preservación de filas no demo; no publicar credenciales ni información personal real.

## Fase 9: alcance aprobado posteriormente

Al redactar este contrato de correcciones, Fase 9 seguía sin decisiones
aprobadas. El owner aprobó después el alcance de certificados; la especificación
vigente es [`CERTIFICATES_CONTRACT.md`](CERTIFICATES_CONTRACT.md) y la decisión
ADR-028 en [`DECISIONS.md`](DECISIONS.md). No se deben usar como pendientes las
preguntas históricas enumeradas en esta versión del contrato. Fase 9 aún no se
implementa; el paso cloud F1–F8 pendiente y su bloqueo operativo se registran en
[`PLAN.md`](PLAN.md)/[`DEMO_SEED.md`](DEMO_SEED.md).
