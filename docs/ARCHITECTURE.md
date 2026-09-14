# ARCHITECTURE

## OBJETIVO

Definir la arquitectura técnica del sistema, responsabilidades entre capas, estructura del repositorio y reglas para mantener el código desacoplado y mantenible.

## ESTILO ARQUITECTÓNICO

El sistema inicia como un **monolito modular full-stack**.

No se utilizará un backend independiente mientras no exista una necesidad concreta de:

- múltiples clientes independientes;
- API pública significativa para terceros;
- integraciones institucionales complejas;
- procesamiento asíncrono especializado;
- escalado independiente;
- despliegues independientes entre frontend y backend.

Astro actuará como host de la aplicación web y de la capa server-side.

## STACK

### Runtime y tooling

- Bun.

Responsabilidades:

- instalar dependencias;
- ejecutar scripts;
- ejecutar herramientas;
- ejecutar tests unitarios cuando corresponda.

Vite no se considera runtime ni package manager del proyecto. Astro ya utiliza Vite internamente.

### Frontend

- Astro.
- React para componentes interactivos.
- Tailwind CSS.
- shadcn/ui.

Astro debe ser la opción por defecto para contenido estático o renderizado en servidor.

React debe utilizarse cuando exista interacción real del lado cliente.

No convertir páginas completas en React sin necesidad.

### Backend integrado

Astro server-side manejará:

- server actions;
- endpoints;
- coordinación de casos de uso;
- autorización;
- acceso a servicios;
- generación de respuestas.

Los endpoints no deben contener lógica de negocio extensa.

### Base de datos

- PostgreSQL mediante Supabase.
- Drizzle ORM como capa de acceso tipada.

Drizzle se utilizará para:

- schema de aplicación;
- queries;
- repositories;
- migraciones según la estrategia definida.

No acceder directamente a tablas desde componentes React.

### Supabase

Se utilizará para:

- PostgreSQL.
- Auth.
- Google OAuth.
- Storage.
- desarrollo local reproducible mediante Supabase CLI + Docker.

Supabase Realtime no debe utilizarse salvo que exista un caso de uso concreto.

### Storage

Los archivos deben clasificarse por sensibilidad y finalidad.

Ejemplos:

Privados:

- documentos administrativos;
- boletas;
- respaldos;
- certificados aún no emitidos;
- archivos internos.

Públicos o verificables:

- certificados emitidos cuando la política lo permita.

La existencia de un archivo en Storage no determina por sí sola su autorización.

## CAPAS

### Presentation

Responsable de:

- páginas Astro;
- componentes React;
- formularios;
- composición visual;
- interacción del usuario.

No debe contener reglas de negocio.

### Application

Responsable de casos de uso.

Ejemplos:

- CreateCourse.
- PublishCourse.
- CreateGroup.
- RegisterParticipant.
- RecordAttendance.
- ConfigureAssessmentPlan.
- RecordGrade.
- CloseGroup.
- IssueCertificate.
- RevokeCertificate.

### Domain

Responsable de:

- reglas de negocio;
- invariantes;
- políticas;
- cálculos;
- estados.

Debe poder probarse con la menor dependencia de infraestructura posible.

### Infrastructure

Responsable de:

- Drizzle;
- PostgreSQL;
- Supabase;
- Storage;
- generación de archivos;
- servicios externos;
- logging;
- integración OAuth.

## MÓDULOS

La aplicación debe mantener límites claros.

Módulos iniciales:

- Auth
- Users
- Courses
- Groups
- Participants
- PreRegistrations
- Enrollments
- Sessions
- Attendance
- Assessments
- Grades
- Payments
- Refunds
- Certificates
- Audit

No es obligatorio que cada módulo sea un package independiente.

El objetivo es separación lógica.

## ESTRUCTURA DE REFERENCIA

```text
src/
├── components/
│   ├── ui/
│   └── shared/
├── layouts/
├── pages/
│   ├── app/
│   ├── cursos/
│   ├── certificados/
│   └── api/
├── features/
│   ├── courses/
│   ├── groups/
│   ├── participants/
│   ├── enrollments/
│   ├── attendance/
│   ├── assessments/
│   ├── certificates/
│   └── ...
├── server/
│   ├── auth/
│   ├── db/
│   │   ├── schema/
│   │   ├── repositories/
│   │   └── migrations/
│   ├── services/
│   ├── policies/
│   └── storage/
├── domain/
│   ├── rules/
│   ├── types/
│   └── errors/
├── lib/
├── styles/
└── test/
```

La estructura puede evolucionar.

No crear directorios vacíos únicamente por seguir este ejemplo.

## RUTAS PÚBLICAS Y PRIVADAS

### Públicas

Ejemplos:

- `/`
- `/cursos`
- `/cursos/[slug]`
- `/preinscripcion/[slug]`
- `/certificados/[code]`
- `/login`

### Privadas

Ejemplos:

- `/app`
- `/app/cursos`
- `/app/grupos`
- `/app/asistencia`
- `/app/evaluaciones`
- `/app/certificados`

Toda ruta privada debe validar sesión y autorización server-side.

## LÓGICA DE NEGOCIO

Ejemplo de flujo incorrecto:

```text
React component
→ db.insert(...)
```

Flujo esperado:

```text
React/Astro
→ action/endpoint
→ application service
→ repository
→ Drizzle
→ PostgreSQL
```

## TRANSACCIONES

Utilizar transacciones cuando una operación requiera consistencia entre múltiples escrituras.

Ejemplos:

- confirmar inscripción;
- cerrar grupo;
- emitir certificado;
- registrar devolución y actualizar estado relacionado.

No dividir artificialmente una operación atómica entre múltiples requests.

## ESTADOS Y ENUMS

Los estados importantes deben modelarse explícitamente.

Ejemplos conceptuales:

Curso:

- draft
- published
- registration_open
- registration_closed
- in_progress
- finished
- archived

Grupo:

- planned
- open
- confirmed
- cancelled
- in_progress
- completed

Certificado:

- pending
- generated
- awaiting_signature
- issued
- revoked
- replaced

La lista definitiva debe mantenerse en el modelo de datos.

## ERRORES

Definir errores de dominio y aplicación diferenciados.

No mostrar errores internos de PostgreSQL al usuario.

Los mensajes públicos deben ser comprensibles.

Los logs internos deben conservar contexto técnico suficiente sin incluir secretos.

## AUDITORÍA

Operaciones sensibles deben ser auditables.

Ejemplos:

- cambios de nota;
- cambios de asistencia;
- confirmación de inscripción;
- aplicación de descuento;
- devolución;
- emisión de certificado;
- revocación;
- cambios de rol.

## CRITERIOS PARA EXTRAER UN BACKEND

Considerar Elysia + Bun únicamente cuando aparezca al menos una necesidad real:

- múltiples aplicaciones cliente;
- API externa estable;
- integraciones externas complejas;
- workers especializados;
- necesidad clara de escalar backend y frontend independientemente.

No extraer backend por anticipación.
