import type { PublicCertificateDto } from "@/domain/certificates/types";
import { notifications } from "@/lib/notifications";
import { hashComparison, localPdfError, localPdfSha256 } from "./local-hash";
import {
  certificateTypeLabel,
  civilDateLabel,
  isPublicCertificateDto,
  publicStateLabel,
  validCredentialCode,
} from "./presentation";

type Tone = "valid" | "invalid" | "error";
class VerificationFailure extends Error {
  constructor(
    message: string,
    readonly tone: Tone = "error",
  ) {
    super(message);
  }
}

function initialize(root: HTMLElement) {
  const local = root.querySelector<HTMLElement>("[data-local-verification]")!;
  const input = local.querySelector<HTMLInputElement>("#local-pdf")!;
  const controls = local.querySelector<HTMLElement>("[data-local-controls]")!;
  const dropzone = local.querySelector<HTMLElement>("[data-local-dropzone]")!;
  const selection = local.querySelector<HTMLElement>("[data-local-selection]")!;
  const filename = local.querySelector<HTMLElement>("[data-file-name]")!;
  const reset = local.querySelector<HTMLButtonElement>("[data-local-reset]")!;
  const result = local.querySelector<HTMLElement>("#local-result")!;
  const message = result.querySelector<HTMLElement>("[data-result-message]")!;
  const form = root.querySelector<HTMLFormElement>("[data-code-verification]")!;
  const code = form.querySelector<HTMLInputElement>("[name=codigo]")!;
  const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
  const codeError = form.querySelector<HTMLElement>("#credential-code-error")!;
  const entry = root.querySelector<HTMLElement>("[data-code-entry]")!;
  const grid = root.querySelector<HTMLElement>(".verification-grid")!;
  const data = root.querySelector<HTMLElement>("[data-public-data]")!;
  const title = root.querySelector<HTMLElement>("[data-public-title]")!;
  const publicError = root.querySelector<HTMLElement>("[data-public-error]")!;
  let latest = 0;
  let operation: AbortController | undefined;
  let notice: string | undefined;
  let selectedHash: string | undefined;
  let source: "code" | "file" | null = local.dataset.officialHash
    ? "code"
    : null;

  const showResult = (text: string, tone?: Tone) => {
    message.textContent = text;
    if (tone) result.dataset.tone = tone;
    else delete result.dataset.tone;
    result
      .querySelectorAll<HTMLElement>("[data-result-icon]")
      .forEach((icon) => {
        icon.hidden = icon.dataset.resultIcon !== tone;
      });
  };
  const showCodeError = (text: string) => {
    codeError.textContent = text;
    codeError.hidden = !text;
    code.setAttribute("aria-invalid", String(Boolean(text)));
  };
  const cancel = () => {
    latest++;
    operation?.abort();
    operation = undefined;
    if (notice) notifications.dismiss(notice);
    notice = undefined;
    submit.disabled = false;
    form.removeAttribute("aria-busy");
    local.removeAttribute("aria-busy");
  };
  const applyRecord = (
    record: PublicCertificateDto | null,
    origin: "code" | "file" | null,
  ) => {
    source = origin;
    publicError.hidden = true;
    const details = record && "recipientName" in record ? record : null;
    // Keep the QR/manual URL bound to the primary credential without navigation.
    if (details)
      history.replaceState(
        null,
        "",
        `/certificados/${encodeURIComponent(details.publicCredentialId)}`,
      );
    else history.replaceState(null, "", "/certificados/verificar");
    root.dataset.hasRecord = String(Boolean(details));
    root.dataset.publicCredentialId = details?.publicCredentialId ?? "";
    data.hidden = !details;
    if (details && origin === "file") {
      // The primary PDF has resolved: keep only its digest, and replace its
      // controls with the complementary code input in the same grid cell.
      local.remove();
      entry.hidden = false;
      if (entry.parentElement !== grid) grid.append(entry);
      if (result.parentElement !== entry) entry.append(result);
      code.setAttribute(
        "aria-describedby",
        "credential-code-error local-result",
      );
      input.value = "";
      filename.textContent = "";
      code.value = "";
    } else {
      if (result.parentElement !== local) local.append(result);
      if (local.parentElement !== grid) grid.append(local);
      if (details) entry.remove();
      else {
        entry.hidden = false;
        grid.insertBefore(entry, local);
      }
    }
    root.querySelector<HTMLElement>("[data-public-state]")!.textContent = record
      ? publicStateLabel[record.state]
      : "Verificar certificado";
    root
      .querySelectorAll<HTMLElement>("[data-public-state-icon]")
      .forEach((icon) => {
        icon.hidden =
          icon.dataset.publicStateIcon !==
          (record?.state === "issued"
            ? "issued"
            : details
              ? "invalid"
              : record
                ? "unavailable"
                : "");
      });
    local.dataset.officialHash = details?.signedSha256 ?? "";
    local.dataset.certificateState = details?.state ?? "";
    const fields = details
      ? {
          recipientName: details.recipientName,
          courseName: details.courseName,
          type: certificateTypeLabel[details.type],
          academicHours: `${details.academicHours} horas académicas`,
          endsOn: civilDateLabel(details.endsOn),
          organization: details.organization,
        }
      : null;
    data
      .querySelectorAll<HTMLElement>("[data-public-field]")
      .forEach((field) => {
        const key = field.dataset.publicField as keyof NonNullable<
          typeof fields
        >;
        field.textContent = fields?.[key] ?? "";
        if (key === "endsOn") {
          if (details) field.setAttribute("datetime", details.endsOn);
          else field.removeAttribute("datetime");
        }
      });
  };
  const readRecord = async (
    response: Response,
  ): Promise<PublicCertificateDto> => {
    if (!response.ok)
      throw new VerificationFailure(
        response.status === 429
          ? "Espera un momento antes de volver a consultar."
          : "No se pudo consultar el registro. Intenta de nuevo.",
      );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new VerificationFailure(
        "No se pudo consultar el registro. Intenta de nuevo.",
      );
    }
    if (!isPublicCertificateDto(payload))
      throw new VerificationFailure(
        "No se pudo consultar el registro. Intenta de nuevo.",
      );
    return payload;
  };
  const lookupCode = async (value: string, signal: AbortSignal) => {
    const record = await readRecord(
      await fetch(`/certificados/${encodeURIComponent(value)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "omit",
        signal,
      }),
    );
    signal.throwIfAborted();
    if ("recipientName" in record && record.publicCredentialId !== value)
      throw new VerificationFailure(
        "No se pudo consultar el registro. Intenta de nuevo.",
      );
    return record;
  };
  const refreshBoundRecord = async (signal: AbortSignal) => {
    const origin = source;
    const record = await lookupCode(root.dataset.publicCredentialId!, signal);
    if (!("recipientName" in record))
      throw new VerificationFailure(publicStateLabel[record.state]);
    // A complementary comparison always uses current authority for this ID,
    // never cached page state or a digest lookup that could select another ID.
    applyRecord(record, origin);
  };
  const compare = (hash: string) => {
    const official = local.dataset.officialHash ?? "";
    const state = local.dataset.certificateState ?? "";
    const text = hashComparison(hash, official, state);
    if (hash.toLowerCase() !== official.toLowerCase() || state !== "issued")
      throw new VerificationFailure(
        text,
        hash.toLowerCase() === official.toLowerCase() ? "invalid" : "error",
      );
    return text;
  };
  const run = async (
    kind: "code" | "file",
    work: (signal: AbortSignal) => Promise<string>,
  ) => {
    cancel();
    const token = latest;
    const current = new AbortController();
    operation = current;
    const id = `certificate-verification-${crypto.randomUUID()}`;
    notice = id;
    const busy = kind === "file" ? local : form;
    busy.setAttribute("aria-busy", "true");
    submit.disabled = kind === "code";
    let abortRead: (() => void) | undefined;
    try {
      const text = await notifications.promise(
        async () =>
          Promise.race([
            work(current.signal),
            new Promise<never>((_, reject) => {
              abortRead = () =>
                reject(
                  new DOMException("Comprobación cancelada.", "AbortError"),
                );
              current.signal.addEventListener("abort", abortRead, {
                once: true,
              });
            }),
          ]),
        {
          id,
          loading: {
            title:
              kind === "file"
                ? "Comprobando tu archivo…"
                : "Consultando certificado…",
          },
          success: {
            title:
              kind === "file" ? "El archivo coincide." : "Certificado vigente.",
          },
          error: (failure: unknown) => {
            if (current.signal.aborted)
              queueMicrotask(() => notifications.dismiss(id));
            return {
              title:
                failure instanceof VerificationFailure &&
                failure.tone === "invalid"
                  ? "Certificado no válido."
                  : "Certificado no verificado.",
              description:
                failure instanceof Error
                  ? failure.message
                  : "No se pudo completar la verificación.",
            };
          },
        },
      );
      if (token !== latest || current.signal.aborted) return;
      if (kind === "file" || source === "file" || input.files?.length)
        showResult(text, "valid");
    } catch (failure) {
      if (token !== latest || current.signal.aborted) return;
      const text =
        failure instanceof Error
          ? failure.message
          : "No se pudo completar la verificación. Intenta de nuevo.";
      const tone =
        failure instanceof VerificationFailure ? failure.tone : "error";
      if (kind === "file" || source === "file" || input.files?.length)
        showResult(text, tone);
      if (kind === "code") {
        if (source !== "file") showCodeError(text);
        else code.setAttribute("aria-invalid", "true");
        if (code.isConnected) code.focus();
        else title.focus();
      }
    } finally {
      if (abortRead) current.signal.removeEventListener("abort", abortRead);
      if (token === latest) {
        busy.removeAttribute("aria-busy");
        submit.disabled = false;
      }
    }
  };
  const clear = () => {
    cancel();
    selectedHash = undefined;
    input.value = "";
    filename.textContent = "";
    selection.hidden = true;
    dropzone.hidden = false;
    input.tabIndex = 0;
    dropzone.removeAttribute("data-invalid");
    input.removeAttribute("aria-invalid");
    showResult("");
    showCodeError("");
  };
  reset.addEventListener("click", () => {
    clear();
    input.focus();
  });
  if (window.crypto?.subtle) controls.hidden = false;
  else
    showResult(
      "La comparación local requiere un navegador compatible y una conexión segura.",
      "error",
    );
  let dragDepth = 0;
  const resetDrag = () => {
    dragDepth = 0;
    dropzone.removeAttribute("data-dragging");
  };
  dropzone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth++;
    dropzone.setAttribute("data-dragging", "");
  });
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  dropzone.addEventListener("dragleave", () => {
    dragDepth--;
    if (dragDepth <= 0) resetDrag();
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    resetDrag();
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    if (files.length !== 1) {
      clear();
      showResult("Selecciona un archivo PDF.", "error");
      input.setAttribute("aria-invalid", "true");
      dropzone.setAttribute("data-invalid", "");
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(files[0]!);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  input.addEventListener("change", () => {
    cancel();
    selectedHash = undefined;
    const file = input.files?.[0];
    filename.textContent = file?.name ?? "";
    selection.hidden = !file;
    dropzone.hidden = Boolean(file);
    input.tabIndex = file ? -1 : 0;
    if (file && document.activeElement === input) reset.focus();
    input.removeAttribute("aria-invalid");
    dropzone.removeAttribute("data-invalid");
    showResult("");
    showCodeError("");
    if (!file) return;
    const validation = localPdfError(file);
    if (validation) {
      showResult(validation, "error");
      input.setAttribute("aria-invalid", "true");
      dropzone.setAttribute("data-invalid", "");
      return;
    }
    void run("file", async (signal) => {
      const hash = await localPdfSha256(file);
      signal.throwIfAborted();
      selectedHash = hash;
      if (root.dataset.publicCredentialId) {
        await refreshBoundRecord(signal);
      } else {
        // Only a digest crosses this boundary. Never send the PDF, name or bytes.
        const record = await readRecord(
          await fetch("/certificados/verificar-archivo", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ sha256: hash }),
            signal,
            cache: "no-store",
            credentials: "omit",
          }),
        );
        signal.throwIfAborted();
        if (!("recipientName" in record))
          throw new VerificationFailure(
            "No se encontró un certificado para este archivo.",
          );
        applyRecord(record, "file");
        code.focus();
      }
      return compare(hash);
    });
  });
  code.addEventListener("input", () => {
    cancel();
    showCodeError("");
    if (source === "file") showResult("");
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = code.value.trim();
    if (!validCredentialCode(value)) {
      showCodeError("Revisa el código de 32 caracteres del certificado.");
      code.focus();
      return;
    }
    showCodeError("");
    showResult("");
    void run("code", async (signal) => {
      const primaryId = root.dataset.publicCredentialId;
      // Complementary input can only verify this primary PDF, never select
      // another credential (even if its public code is otherwise valid).
      if (source === "file" && value !== primaryId)
        throw new VerificationFailure(
          "El código no coincide con el certificado del archivo.",
        );
      if (source === "file") {
        await refreshBoundRecord(signal);
        code.value = value;
        code.focus();
        return compare(selectedHash!);
      }
      const record = await lookupCode(value, signal);
      applyRecord(record, "code");
      if (!("recipientName" in record))
        throw new VerificationFailure(publicStateLabel[record.state]);
      const file = input.files?.[0];
      if (file) {
        const validation = localPdfError(file);
        if (validation) throw new VerificationFailure(validation);
        const hash = selectedHash ?? (await localPdfSha256(file));
        signal.throwIfAborted();
        selectedHash = hash;
        await refreshBoundRecord(signal);
        title.focus();
        return compare(hash);
      }
      if (!record.valid)
        throw new VerificationFailure(
          publicStateLabel[record.state],
          "invalid",
        );
      title.focus();
      return publicStateLabel[record.state];
    });
  });
  window.addEventListener("pagehide", cancel, { once: true });
  document.addEventListener("astro:before-swap", cancel, { once: true });
  if (source === "code") entry.remove();
}
const root = document.querySelector<HTMLElement>("[data-public-verification]");
if (root) initialize(root);
