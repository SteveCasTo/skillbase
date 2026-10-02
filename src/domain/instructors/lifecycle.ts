import type { AuthRole } from "@/domain/auth/types";
import { InstructorError } from "./profile";

export interface InstructorLifecycle {
  readonly status: "ACTIVE" | "DISABLED" | "INVITED";
  readonly exclusiveInstructor: boolean;
  readonly assignedHistorically: boolean;
  readonly hasDependencies: boolean;
  readonly deletionPending: boolean;
  readonly courses: readonly { id: string; name: string }[];
}

export function isExclusiveInstructor(roles: readonly AuthRole[]): boolean {
  return roles.length === 1 && roles[0] === "INSTRUCTOR";
}

export function lifecycleBlockReason(
  state: InstructorLifecycle,
  action: "activate" | "deactivate" | "delete",
): string | null {
  if (!state.exclusiveInstructor)
    return "Esta cuenta tiene otros roles. No se puede modificar su acceso desde Instructores.";
  if (state.deletionPending)
    return "La eliminación de la cuenta está pendiente. El acceso permanece bloqueado; reintenta la eliminación.";
  if (
    action === "delete" &&
    (state.assignedHistorically || state.hasDependencies)
  )
    return "La cuenta tiene historial o referencias administrativas. Conserva su identidad y utiliza activar o desactivar.";
  if (action === "deactivate" && state.courses.length)
    return `Reasigna o archiva estos cursos antes de desactivar al instructor: ${state.courses.map((course) => course.name).join(", ")}.`;
  if (action === "activate" && state.status !== "DISABLED")
    return "La cuenta ya está activa.";
  if (action === "deactivate" && state.status !== "ACTIVE")
    return "La cuenta no está activa.";
  return null;
}

export function assertInstructorLifecycle(
  state: InstructorLifecycle,
  action: "activate" | "deactivate" | "delete",
): void {
  const reason = lifecycleBlockReason(state, action);
  if (reason) throw new InstructorError(reason);
}
