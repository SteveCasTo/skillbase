import { useState } from "react";
import { Input } from "@/components/ui/input";
import { nextCourseInput } from "./course-input-filter";

/** Historical courses retain their original free-text schedule. */
export default function CourseSchedulePicker({
  value,
  error,
  disabled,
}: {
  value: string;
  error?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  return (
    <div className="sm:col-span-2">
      <label htmlFor="course-schedule" className="text-sm font-medium">
        Horario informativo legado
      </label>
      <Input
        id="course-schedule"
        name="schedule"
        value={text}
        required
        disabled={disabled}
        data-course-input="text"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "schedule-error" : undefined}
        className="mt-2 min-h-11"
        onChange={(event) =>
          setText(nextCourseInput("text", text, event.target.value))
        }
      />
      {error && (
        <p
          id="schedule-error"
          role="alert"
          className="text-destructive mt-1 text-sm"
        >
          {error}
        </p>
      )}
    </div>
  );
}
