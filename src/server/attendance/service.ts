import { getDatabase } from "@/server/db/client";
import { DrizzleAttendanceRepository } from "@/server/db/repositories/attendance-repository";
export const getAttendanceRepository = () =>
  new DrizzleAttendanceRepository(getDatabase());
