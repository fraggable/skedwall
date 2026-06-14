"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

type CopyButtonProps = {
  value: string;
  label?: string;
  className?: string;
};

export function CopyButton({ value, label = "copy", className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const Icon = copied ? Check : Copy;

  return (
    <button
      type="button"
      onClick={copyValue}
      className={`inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50 ${className}`}
      aria-label={copied ? "copied" : label}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>{copied ? "copied" : label}</span>
    </button>
  );
}