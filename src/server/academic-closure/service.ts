import { getDatabase } from "@/server/db/client";
import { DrizzleClosureRepository } from "@/server/db/repositories/academic-closure-repository";
export const getClosureRepository = () =>
  new DrizzleClosureRepository(getDatabase());
