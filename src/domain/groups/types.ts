export interface Group {
  readonly id: string;
  readonly courseId: string;
  readonly courseTypeRevisionId: string;
  readonly capacity: number;
  readonly status: "PLANNED" | "CANCELLED";
  readonly publishedAt: Date | null;
  /** Server-derived lifecycle permission; absent on legacy command projections. */
  readonly canDelete?: boolean;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
