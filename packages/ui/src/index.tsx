import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

export function Button({
  children,
  ...props
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      className="rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
      {...props}
    >
      {children}
    </button>
  );
}

export function Panel({ children }: PropsWithChildren) {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-6">{children}</section>
  );
}
