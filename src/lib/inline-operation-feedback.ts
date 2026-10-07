import { notifications, type NotificationOptions } from "./notifications";

/** For operations whose caller renders persistent, actionable failure feedback. */
export async function notifyInlineOperation<T>(
  operation: () => Promise<T>,
  options: {
    loading: NotificationOptions;
    success: NotificationOptions | ((value: T) => NotificationOptions);
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
    // The caller owns the field/page error. Keep the rejection intact for recovery.
    notifications.dismiss(id);
    throw failure;
  }
}
