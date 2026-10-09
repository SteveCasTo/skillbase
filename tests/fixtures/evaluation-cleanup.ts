import { sql } from "drizzle-orm";

/** Runner-owned isolated QA only. Include these child tables in the SAME
 * TRUNCATE RESTRICT statement as courses/registrations/participants: PostgreSQL
 * checks referencing FKs even when the child tables are already empty.
 * This is not a production/demo reset allowlist.
 */
export const evaluationFixtureTables = sql`certificate_artifacts, certificate_events, certificate_receipts, certificates, academic_group_reopenings, academic_closure_receipts, academic_closure_versions, academic_group_states, evaluation_grades, evaluation_results, evaluation_components, evaluation_schemes, evaluation_command_receipts`;
