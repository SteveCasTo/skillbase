-- The immutable-revision trigger uses no unqualified application objects.
-- Pin its lookup path so it cannot inherit the invoking role's search_path.
ALTER FUNCTION public.reject_course_type_revision_mutation() SET search_path = '';
