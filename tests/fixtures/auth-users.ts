export const AUTH_FIXTURES = {
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
