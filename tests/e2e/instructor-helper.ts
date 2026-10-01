import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { createInstructorFixture } from "../fixtures/instructors";

const assigned = new WeakMap<Page, { id: string; name: string }>();
export async function registerCourseInstructor(page: Page) {
  const db = createDatabase(getTestSupabaseEnvironment().databaseUrl);
  try {
    const user = await createInstructorFixture(db.db);
    const lastName = `E2E ${randomUUID()}`;
    await db.db
      .update(schema.instructorProfiles)
      .set({ firstName: "Docente", lastName })
      .where(eq(schema.instructorProfiles.id, user.id));
    const result = { id: user.id, name: `Docente ${lastName}` };
    assigned.set(page, result);
    return result;
  } finally {
    await db.close();
  }
}
export function courseInstructor(page: Page) {
  const result = assigned.get(page);
  if (!result)
    throw new Error("Instructor fixture was not registered before page load");
  return result;
}
export async function chooseCourseInstructor(page: Page) {
  await expect(
    page.getByRole("combobox", { name: "Instructor", exact: true }),
  ).toHaveAttribute("data-state", "closed");
  await page.getByRole("combobox", { name: "Instructor", exact: true }).click();
  await page
    .getByRole("option", { name: courseInstructor(page).name, exact: true })
    .click();
}
