import type { AstroGlobal } from "astro";
import { requireInternalUser } from "@/server/auth/context";
import { loadCertificates } from "@/server/certificates/loaders";
import { loadAcademicClosure } from "@/server/academic-closure/loaders";
import { certificateRecipients } from "@/domain/certificates/rules";
import { certificateMethodNotAllowed, setCertificateHeaders } from "./route";

export async function prepareGroupCertificates(
  astro: AstroGlobal,
  instructorRoute: boolean,
) {
  setCertificateHeaders(astro);
  if (astro.request.method !== "GET") return certificateMethodNotAllowed("GET");
  const actor = requireInternalUser(astro.locals);
  const courseId = astro.params.id ?? "",
    groupId = astro.params.groupId ?? "";
  const context = { actor, courseId, groupId };
  const load = await loadCertificates(context);
  if (!load.available) astro.response.status = load.status;
  const closure = load.available ? await loadAcademicClosure(context) : null;
  const current =
    closure?.available && closure.data.status === "CLOSED"
      ? closure.data.official
      : null;
  const report =
    current?.report ?? (closure?.available ? closure.data.provisional : null);
  const sections = (["APPROVAL", "INSTRUCTOR"] as const).map((type) => {
    let recipients: { id: string; name: string }[] = [];
    if (current) {
      try {
        recipients = certificateRecipients(current.report, type);
      } catch {
        /* empty official eligibility */
      }
    } else if (instructorRoute && load.available) {
      // Historical certificate ownership survives a later live reassignment.
      // These recipients were validated against their immutable official source.
      recipients = load.data
        .filter((row) => row.type === type)
        .filter(
          (row, index, rows) =>
            rows.findIndex((other) => other.recipientId === row.recipientId) ===
            index,
        )
        .map((row) => ({ id: row.recipientId, name: row.data.recipientName }));
    }
    return {
      type,
      recipients: recipients.map((recipient) => ({
        ...recipient,
        record: load.available
          ? (load.data.find(
              (row) =>
                row.type === type &&
                row.recipientId === recipient.id &&
                row.state !== "revoked",
            ) ??
            load.data.findLast(
              (row) => row.type === type && row.recipientId === recipient.id,
            ))
          : undefined,
      })),
    };
  });
  return {
    load,
    closure,
    current,
    title: report?.courseName ?? "Certificados",
    groupName:
      report?.groupName ??
      (load.available && load.data[0]
        ? `${load.data[0].data.groupStartsAt}–${load.data[0].data.groupEndsAt}`
        : ""),
    sections,
    courseId,
    groupId,
    instructorRoute,
  };
}
export type GroupCertificateProps = Exclude<
  Awaited<ReturnType<typeof prepareGroupCertificates>>,
  Response
>;
