import { CircleAlert, CircleCheck } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { LogoMark, Rings, Wordmark } from "./brand";
import { Spinner, cx } from "./ui";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Kerangka halaman masuk / lupa / atur ulang kata sandi: panel brand + kartu form (sama persis di semua halaman). */
export function AuthShell({ title, sub, onSubmit, children }: { title: string; sub?: string; onSubmit?: (e: FormEvent) => void; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* HP: logo di tengah, lebar & jarak tepi (16px) sama dengan kartu form di bawahnya */}
      <div className="bg-hero relative flex flex-col justify-between overflow-hidden px-4 pb-[104px] pt-12 text-white sm:pt-16 lg:px-14 lg:py-12">
        <Rings className="pointer-events-none absolute -right-[300px] -top-[140px] size-[760px]" />
        <div className="relative mx-auto flex w-full max-w-[420px] items-center justify-center gap-3 lg:mx-0 lg:max-w-none lg:justify-start">
          <LogoMark variant="white" size={44} />
          <div className="flex min-w-0 flex-col">
            <Wordmark onDark className="text-[19px] font-bold leading-tight" />
            <span className="truncate text-[11.5px] font-medium tracking-[.08em] opacity-75">RS AWAL BROS BOTANIA</span>
          </div>
        </div>
        <span className="relative hidden text-[12.5px] font-medium opacity-70 lg:block">© RS Awal Bros Botania</span>
      </div>

      <div className="-mt-[72px] flex items-start justify-center px-4 pb-8 lg:mt-0 lg:items-center lg:px-8 lg:py-12">
        <form onSubmit={onSubmit} noValidate className="relative flex w-full max-w-[420px] flex-col gap-4 rounded-xl border border-line bg-card p-5 shadow-card lg:p-7">
          <div className="flex flex-col gap-1.5">
            <span className="text-[22px] font-semibold lg:text-[26px]">{title}</span>
            {sub && <span className="text-sm leading-normal text-muted">{sub}</span>}
          </div>
          {children}
        </form>
      </div>
    </div>
  );
}

const inputCls =
  "h-12 w-full rounded-lg border border-line bg-field pl-11 text-[15px] text-ink outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-2 focus:ring-brand/15";

/** Input dengan ikon di kiri (dan tombol opsional di kanan). */
export function AuthField({
  label,
  icon,
  invalid,
  right,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; icon: ReactNode; invalid?: boolean; right?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      <span className="relative">
        <span className="pointer-events-none absolute left-3.5 top-3.5 text-faint">{icon}</span>
        <input {...input} className={cx(inputCls, right ? "pr-12" : "pr-4", invalid && "border-bad focus:border-bad focus:ring-bad/15")} />
        {right && <span className="absolute right-1.5 top-1.5">{right}</span>}
      </span>
    </label>
  );
}

export function AuthButton({ busy, children }: { busy?: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="bg-cta mt-1 flex h-12 items-center justify-center gap-2.5 rounded-lg text-[15px] font-medium text-white transition-colors disabled:opacity-80"
    >
      {busy && <Spinner light size={18} />}
      {busy ? "Memproses…" : children}
    </button>
  );
}

export function AuthAlert({ tone, title, body }: { tone: "error" | "info" | "ok"; title: string; body?: string }) {
  const c = tone === "error" ? "bg-bad-bg text-bad" : tone === "ok" ? "bg-ok-bg text-ok" : "bg-brand-soft text-brand";
  const Icon = tone === "ok" ? CircleCheck : CircleAlert;
  return (
    <div className={cx("flex items-start gap-2.5 rounded-lg px-3.5 py-3", c)}>
      <Icon size={18} className="mt-px flex-none" />
      <div className="flex flex-col gap-0.5">
        <span className="text-[13.5px] font-medium">{title}</span>
        {body && <span className="text-[13px] leading-[1.45] text-muted">{body}</span>}
      </div>
    </div>
  );
}
