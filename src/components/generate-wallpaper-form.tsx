"use client";

import { WandSparkles } from "lucide-react";
import { useActionState } from "react";

import { generateTodayWallpaper } from "@/app/dashboard/actions";

type GenerateWallpaperFormProps = {
  disabled: boolean;
};

export function GenerateWallpaperForm({ disabled }: GenerateWallpaperFormProps) {
  const [state, formAction, isPending] = useActionState(generateTodayWallpaper, {});

  return (
    <form action={formAction} className="mt-5 grid justify-items-center gap-3 text-center">
      <button
        type="submit"
        className="inline-flex w-full max-w-64 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50 sm:w-fit"
        disabled={disabled || isPending}
      >
        <WandSparkles className="size-4" aria-hidden="true" />
        <span>{isPending ? "generating..." : "generate today.jpg"}</span>
      </button>
      {state.error ? (
        <p className="max-w-md text-sm text-destructive">{state.error}</p>
      ) : null}
      {state.success ? (
        <p className="text-sm text-muted-foreground">{state.success}</p>
      ) : null}
    </form>
  );
}