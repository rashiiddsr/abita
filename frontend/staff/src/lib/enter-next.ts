/**
 * Enter di kolom isian = pindah ke kolom berikutnya (seperti aplikasi HP); di kolom terakhir = kirim.
 * Berlaku di <form>, lembar/modal ([role=dialog]) dan wadah [data-enter-scope]. Kolom terakhir di wadah tanpa <form>
 * menekan tombol [data-submit] di wadah itu. Tombol "enter" keyboard HP diberi label sesuai (enterkeyhint next/go).
 * Dipasang sekali di main.tsx: installEnterNext().
 */
const FIELDS = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])';
const TEXTLIKE = /^(text|email|password|search|tel|url|number|date|time|datetime-local|month|week)$/;

const scopeOf = (el: Element) => el.closest<HTMLElement>("form, [role=dialog], [data-enter-scope]");
const visible = (el: HTMLElement) => el.offsetParent !== null || el.getClientRects().length > 0;
const fieldsIn = (scope: HTMLElement) => [...scope.querySelectorAll<HTMLElement>(FIELDS)].filter(visible);

function isTextInput(el: EventTarget | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && TEXTLIKE.test(el.type || "text");
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.isComposing || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
  const t = e.target;
  if (!isTextInput(t)) return; // textarea: Enter = baris baru
  const scope = scopeOf(t);
  if (!scope) return;
  const list = fieldsIn(scope);
  const next = list[list.indexOf(t) + 1];
  if (next) {
    e.preventDefault();
    next.focus();
    return;
  }
  if (scope instanceof HTMLFormElement) return; // kolom terakhir di <form>: kirim seperti biasa
  const submit = scope.querySelector<HTMLButtonElement>("[data-submit]:not([disabled])");
  if (submit) {
    e.preventDefault();
    submit.click();
  }
}

function onFocusIn(e: FocusEvent) {
  const t = e.target;
  if (!isTextInput(t) || t.hasAttribute("data-enterkeyhint-fixed")) return;
  const scope = scopeOf(t);
  if (!scope) return;
  const list = fieldsIn(scope);
  const last = list.indexOf(t) === list.length - 1;
  t.setAttribute("enterkeyhint", !last ? "next" : scope instanceof HTMLFormElement || scope.querySelector("[data-submit]") ? "go" : "done");
}

let installed = false;
export function installEnterNext() {
  if (installed) return;
  installed = true;
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("focusin", onFocusIn);
}
