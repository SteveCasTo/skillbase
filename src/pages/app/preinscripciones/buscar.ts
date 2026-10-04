import type { APIRoute } from "astro";
import { requireInternalUser } from "@/server/auth/context";
import { lookupRegistrationPeople } from "@/server/pre-registrations/loaders";
import {
  registrationFailure,
  registrationJson,
  singleQuery,
} from "@/server/pre-registrations/http";
import { validateRegistrationId } from "@/domain/pre-registrations/validation";
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const params = new URL(request.url).searchParams;
    const courseId = singleQuery(params, "courseId");
    const result = await lookupRegistrationPeople(
      requireInternalUser(locals),
      singleQuery(params, "search"),
      courseId ? validateRegistrationId(courseId, "courseId") : undefined,
    );
    return registrationJson({ ok: true, ...result });
  } catch (error) {
    const failure = registrationFailure(error);
    return registrationJson(failure.payload, failure.status);
  }
};
