import { notifications, type NotificationOptions } from "./notifications";

/** Keep field validation inline; report operational failures through Sileo. */
export async function notifyInlineOperation<T>(
  operation: () => Promise<T>,
  options: {
    loading: NotificationOptions;
    success: NotificationOptions | ((value: T) => NotificationOptions);
    isFieldFailure?: (failure: unknown) => boolean;
  },
): Promise<T> {
  const id = options.loading.id ?? `notification-${crypto.randomUUID()}`;
  notifications.loading({ ...options.loading, id });
  try {
    const value = await operation();
    notifications.success({
      ...(typeof options.success === "function"
        ? options.success(value)
        : options.success),
      id,
    });
    return value;
  } catch (failure) {
    if (options.isFieldFailure?.(failure)) notifications.dismiss(id);
    else
      notifications.error({
        id,
        title:
          failure instanceof Error
            ? failure.message
            : "No se pudo completar la operación. Reintenta.",
      });
    throw failure;
  }
}
