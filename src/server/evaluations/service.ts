import { getDatabase } from "@/server/db/client";
import { DrizzleEvaluationRepository } from "@/server/db/repositories/evaluation-repository";
export const getEvaluationRepository = () =>
  new DrizzleEvaluationRepository(getDatabase());
