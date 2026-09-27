export interface Group {
  readonly id: string;
  readonly courseId: string;
  readonly courseTypeRevisionId: string;
  readonly capacity: number;
  readonly status: "PLANNED" | "CANCELLED";
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
