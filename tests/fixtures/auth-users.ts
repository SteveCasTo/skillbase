export const AUTH_FIXTURES = {
  googleLegacyAdmin: {
    email: "google-legacy.fixture@example.test",
    name: "Legacy Google Admin",
  },
  associationOwner: {
    email: "association-owner.fixture@example.test",
    name: "Association Owner",
    password: "Synthetic-Association-Password-2026",
  },
  associationStale: {
    email: "association-stale.fixture@example.test",
    name: "Association Stale",
    password: "Synthetic-Association-Password-2026",
  },
  passwordAdmin: {
    email: "password-admin.fixture@example.test",
    name: "Password Admin",
    password: "Synthetic-Auth-Fixture-2026",
  },
  passwordInstructor: {
    email: "password-instructor.fixture@example.test",
    name: "Password Instructor",
    password: "Synthetic-Auth-Fixture-2026",
  },
  admin: { email: "admin.fixture@example.test", name: "Ada Admin" },
  instructor: {
    email: "instructor.fixture@example.test",
    name: "Iris Instructor",
  },
  multiRole: { email: "multi.fixture@example.test", name: "Morgan Multi" },
  mobileMultiRole: {
    email: "mobile-multi.fixture@example.test",
    name: "Max Mobile",
  },
  futureRoute: { email: "future.fixture@example.test", name: "Fran Future" },
  originAdmin: { email: "origin.fixture@example.test", name: "Omar Origin" },
  logoutAdmin: { email: "logout.fixture@example.test", name: "Lara Logout" },
  disabled: { email: "disabled.fixture@example.test", name: "Dana Disabled" },
  noRole: { email: "norole.fixture@example.test", name: "Nora No Role" },
  unknown: { email: "unknown.fixture@example.test", name: "Uma Unknown" },
} as const;
