"use client";

import { Upload } from "lucide-react";
import { useActionState } from "react";

import { uploadWallpaper } from "@/app/dashboard/actions";

export function UploadWallpaperForm() {
  const [state, formAction, isPending] = useActionState(uploadWallpaper, {});

  return (
    <form action={formAction} className="mt-4 grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          name="wallpaper"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="min-w-0 rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium disabled:opacity-50"
          disabled={isPending}
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={isPending}
        >
          <Upload className="size-4" aria-hidden="true" />
          <span>{isPending ? "uploading..." : "upload"}</span>
        </button>
      </div>
      {state.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state.success ? (
        <p className="text-sm text-muted-foreground">{state.success}</p>
      ) : null}
    </form>
  );
}