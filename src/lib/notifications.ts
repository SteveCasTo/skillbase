import { sileo, type SileoOptions } from "sileo";

export const notificationPosition = "bottom-right";

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
): RuntimeNotificationOptions & Required<Pick<SileoOptions, "position">> {
  // Without an id, the vendor replaces the shared "sileo-default" toast.
  return {
    ...options,
    // Sileo captures its store's position at creation, before Toaster's effect
    // may have run. Pin the default so queued and post-mount notices agree.
    position: options.position ?? notificationPosition,
    id: options.id ?? `notification-${crypto.randomUUID()}`,
  };
}

export const notifications = {
  success: (options: NotificationOptions) => sileo.success(withId(options)),
  error: (options: NotificationOptions) => sileo.error(withId(options)),
  info: (options: NotificationOptions) => sileo.info(withId(options)),
  warning: (options: NotificationOptions) => sileo.warning(withId(options)),
  loading: (options: NotificationOptions) =>
    sileo.show({ duration: null, ...withId(options), type: "loading" }),
  promise<T>(
    operation: Promise<T> | (() => Promise<T>),
    options: NotificationPromiseOptions<T>,
  ): Promise<T> {
    const { id, ...rest } = options;
    const loading = withId(
      id === undefined ? options.loading : { ...options.loading, id },
    );
    // The vendor captures loading.id and reuses it for success/error/action.
    // Return its actual promise unchanged: value, identity and rejection remain intact.
    // The vendor overwrites loading.position with the promise-level position.
    return sileo.promise(operation, {
      ...rest,
      position: rest.position ?? loading.position,
      loading,
    });
  },
};
