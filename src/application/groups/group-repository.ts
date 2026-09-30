import type { Group } from "@/domain/groups/types";

export interface GroupRepository {
  list(courseId: string): Promise<readonly Group[]>;
  create(
    courseId: string,
    startTime: string,
    capacity: number,
    actorId: string,
  ): Promise<Group>;
  changeSchedule(
    id: string,
    startTime: string,
    actorId: string,
    revision: Date,
  ): Promise<Group>;
  changeCapacity(
    id: string,
    capacity: number,
    actorId: string,
    revision: Date,
  ): Promise<Group>;
  cancel(id: string, actorId: string, revision: Date): Promise<Group>;
  reactivate(id: string, actorId: string, revision: Date): Promise<Group>;
  delete(id: string, actorId: string, revision: Date): Promise<void>;
}
