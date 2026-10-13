/** Student identity only. Instructor profiles retain their independent contract. */
export interface ParticipantName {
  firstName: string;
  paternalSurname: string;
  maternalSurname: string;
}

export function participantFullName(person: ParticipantName): string {
  return `${person.firstName} ${person.paternalSurname} ${person.maternalSurname}`;
}

export function compareParticipantNames(
  a: ParticipantName,
  b: ParticipantName,
): number {
  return (
    a.paternalSurname.localeCompare(b.paternalSurname) ||
    a.maternalSurname.localeCompare(b.maternalSurname) ||
    a.firstName.localeCompare(b.firstName)
  );
}
