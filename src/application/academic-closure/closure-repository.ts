import type {
  ClosureCommand,
  ClosureCommandResult,
  ClosureStateDto,
  ClosureVersionDto,
  ReopenGroupInput,
} from "@/domain/academic-closure/types";
export interface ClosureRepository {
  getGroup(
    actorId: string,
    courseId: string,
    groupId: string,
  ): Promise<ClosureStateDto>;
  getVersion(
    actorId: string,
    courseId: string,
    groupId: string,
    version: number,
  ): Promise<ClosureVersionDto>;
  close(actorId: string, input: ClosureCommand): Promise<ClosureCommandResult>;
  reopen(
    actorId: string,
    input: ReopenGroupInput,
  ): Promise<ClosureCommandResult>;
}
