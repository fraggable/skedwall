"use client";

import { useEffect, useId, useState } from "react";
import { Copy, X } from "lucide-react";

type ShortcutInstructionsProps = {
  lockScreenUrl: string;
  homeScreenUrl: string;
};

export function ShortcutInstructions({
  lockScreenUrl,
  homeScreenUrl,
}: ShortcutInstructionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  async function copyUrl(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md border px-4 py-2 text-sm font-medium"
      >
        iOS shortcut setup
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b p-5">
              <div>
                <h2 id={titleId} className="text-xl font-semibold">
                  iOS shortcut setup
                </h2>
                <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
                  Use this after at least one wallpaper has been generated.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-md border p-2"
                aria-label="Close instructions"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid gap-6 p-5 text-sm leading-6">
              <section>
                <h3 className="font-semibold">Shortcut</h3>
                <ol className="mt-3 grid list-decimal gap-2 pl-5">
                  <li>Open the Shortcuts app on your iPhone.</li>
                  <li>Create a new shortcut.</li>
                  <li>Add Get Contents of URL and paste the lock screen URL.</li>
                  <li>Add Set Wallpaper and set it to Lock Screen only.</li>
                  <li>Add Get Contents of URL again and paste the home screen URL.</li>
                  <li>Add Set Wallpaper again and set it to Home Screen only.</li>
                  <li>Turn off Show Preview and Ask Before Running where iOS offers those options.</li>
                  <li>Run the shortcut once manually to confirm both wallpapers update correctly.</li>
                </ol>
              </section>

              <section>
                <h3 className="font-semibold">URLs</h3>
                <div className="mt-3 grid gap-3">
                  <div className="grid gap-3 rounded-md border bg-muted p-3">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      lock screen rendered image
                    </p>
                    <p className="break-all font-mono text-xs">{lockScreenUrl}</p>
                    <button
                      type="button"
                      onClick={() => copyUrl(lockScreenUrl)}
                      className="flex w-fit items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium"
                    >
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      copy lock url
                    </button>
                  </div>
                  <div className="grid gap-3 rounded-md border bg-muted p-3">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      home screen clean image
                    </p>
                    <p className="break-all font-mono text-xs">{homeScreenUrl}</p>
                    <button
                      type="button"
                      onClick={() => copyUrl(homeScreenUrl)}
                      className="flex w-fit items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium"
                    >
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      copy home url
                    </button>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="font-semibold">Automation</h3>
                <ol className="mt-3 grid list-decimal gap-2 pl-5">
                  <li>In Shortcuts, open the Automation tab.</li>
                  <li>Create a new personal automation.</li>
                  <li>Choose Time of Day.</li>
                  <li>Set it to run daily after backend generation, such as 12:05 AM or your wake-up time.</li>
                  <li>Select Run Shortcut and choose the shortcut you created.</li>
                  <li>Disable confirmation prompts where iOS allows it.</li>
                </ol>
              </section>

              <section className="rounded-md border p-3 text-muted-foreground">
                Backend generation runs near 11:58 PM in your configured timezone.
                Set the iOS automation later than that so the newest generated images are ready.
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}