import { sileo, type SileoOptions } from "sileo";

export const notificationPosition = "bottom-right";
const redirectNoticeKey = "skillbase:redirect-notice";

/** Carry only transient feedback across a full-document redirect, never form values. */
export function queueRedirectNotice(destination: string, title: string): void {
  try {
    sessionStorage.setItem(
      redirectNoticeKey,
      JSON.stringify({ destination, title, expires: Date.now() + 30000 }),
    );
  } catch {
    // Storage may be disabled; authorization/navigation must still complete.
  }
}

export function showRedirectNotice(): void {
  try {
    const raw = sessionStorage.getItem(redirectNoticeKey);
    sessionStorage.removeItem(redirectNoticeKey);
    if (!raw) return;
    const notice: unknown = JSON.parse(raw);
    if (
      typeof notice !== "object" ||
      notice === null ||
      !("destination" in notice) ||
      !("title" in notice) ||
      !("expires" in notice)
    )
      return;
    if (
      typeof notice.destination !== "string" ||
      typeof notice.title !== "string" ||
      typeof notice.expires !== "number" ||
      notice.expires < Date.now()
    )
      return;
    const destination = new URL(notice.destination, location.origin);
    if (
      destination.origin === location.origin &&
      destination.pathname === location.pathname
    )
      notifications.success({ title: notice.title });
  } catch {
    // An invalid/blocked storage entry is not a page failure.
  }
}

export type NotificationOptions = SileoOptions & { id?: string };
// Sileo 0.1.5 consumes id at runtime, but omits it from its declarations.
export type RuntimeNotificationOptions = SileoOptions & { id: string };
type SileoPromiseOptions<T> = Parameters<typeof sileo.promise<T>>[1];
export type NotificationPromiseOptions<T> = Omit<
  SileoPromiseOptions<T>,
  "loading"
> & {
  id?: string;
  loading: NotificationOptions;
};

function withId(
  options: NotificationOptions,
  state: "success" | "error" | "warning" | "info" | "loading" = "info",
): RuntimeNotificationOptions & Required<Pick<SileoOptions, "position">> {
  const titles = {
    success: "Operación completada",
    error: "No se completó la operación",
    warning: "Revisa esta información",
    info: "Información",
    loading: "Procesando…",
  };
  // The vendor pill measures a single-line title, which can exceed the mobile
  // viewport. Put lengthy messages in its wrapping, automatically expanded body.
  const presentation =
    options.title && options.title.length > 40 && !options.description
      ? { ...options, title: titles[state], description: options.title }
      : options;
  // Without an id, the vendor replaces the shared "sileo-default" toast.
  return {
    duration: 8000,
    autopilot: { expand: 0, collapse: options.duration ?? 8000 },
    ...presentation,
    // Sileo captures its store's position at creation, before Toaster's effect
    // may have run. Pin the default so queued and post-mount notices agree.
    position: options.position ?? notificationPosition,
    id: options.id ?? `notification-${crypto.randomUUID()}`,
  };
}

export const notifications = {
  clear: () => sileo.clear(),
  dismiss: (id: string) => sileo.dismiss(id),
  success: (options: NotificationOptions) =>
    sileo.success(withId(options, "success")),
  error: (options: NotificationOptions) =>
    sileo.error(withId(options, "error")),
  info: (options: NotificationOptions) => sileo.info(withId(options, "info")),
  warning: (options: NotificationOptions) =>
    sileo.warning(withId(options, "warning")),
  loading: (options: NotificationOptions) =>
    sileo.show({
      ...withId(options, "loading"),
      duration: options.duration === undefined ? null : options.duration,
      type: "loading",
    }),
  promise<T>(
    operation: Promise<T> | (() => Promise<T>),
    options: NotificationPromiseOptions<T>,
  ): Promise<T> {
    const { id, ...rest } = options;
    const loading = withId(
      id === undefined ? options.loading : { ...options.loading, id },
      "loading",
    );
    // The vendor captures loading.id and reuses it for success/error/action.
    // Return its actual promise unchanged: value, identity and rejection remain intact.
    // The vendor overwrites loading.position with the promise-level position.
    return sileo.promise(operation, {
      ...rest,
      position: rest.position ?? loading.position,
      loading,
      success: (value: T) =>
        withId(
          {
            position: rest.position ?? loading.position,
            ...(typeof rest.success === "function"
              ? rest.success(value)
              : rest.success),
            id: loading.id,
          },
          "success",
        ),
      error: (error: unknown) =>
        withId(
          {
            position: rest.position ?? loading.position,
            ...(typeof rest.error === "function"
              ? rest.error(error)
              : rest.error),
            id: loading.id,
          },
          "error",
        ),
    });
  },
};
