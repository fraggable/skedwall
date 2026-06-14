import { auth } from "@/auth";
import {
  deleteWallpaper,
  regenerateWallpaperToken,
  setWallpaperEnabled,
  updateSettings,
} from "@/app/dashboard/actions";
import {
  ReconnectGoogleButton,
  SignInButton,
  SignOutButton,
} from "@/components/auth-buttons";
import { CopyButton } from "@/components/copy-button";
import { GenerateWallpaperForm } from "@/components/generate-wallpaper-form";
import { ShortcutInstructions } from "@/components/shortcut-instructions";
import { ThemeToggle } from "@/components/theme-toggle";
import { UploadWallpaperForm } from "@/components/upload-wallpaper-form";
import { WallpaperMode } from "@/generated/prisma/client";
import { getBaseUrl } from "@/lib/env";
import { hasGoogleCalendarScope } from "@/lib/google-scopes";
import { prisma } from "@/lib/prisma";
import {
  createSupabaseAdminClient,
  getStorageBucket,
} from "@/lib/supabase-admin";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const fieldClass =
  "rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const panelClass = "rounded-lg border bg-card p-4 shadow-sm sm:p-5";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.email) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <h1 className="text-2xl font-bold">skedwall.</h1>
        <p className="text-muted-foreground">sign in to continue.</p>
        <SignInButton />
      </main>
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: {
      accounts: true,
      settings: true,
      wallpapers: {
        orderBy: { createdAt: "desc" },
      },
      generatedImages: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <h1 className="text-2xl font-bold">skedwall.</h1>
        <p className="text-muted-foreground">
          your account is still being created. refresh in a moment.
        </p>
        <SignOutButton />
      </main>
    );
  }

  const settings =
    user.settings ??
    (await prisma.userSettings.create({
      data: {
        userId: user.id,
      },
    }));
  const googleAccount = user.accounts.find(
    (account) => account.provider === "google",
  );
  const hasCalendarAccess = hasGoogleCalendarScope(googleAccount?.scope);
  const wallpaperUrl = `${getBaseUrl()}/w/${settings.wallpaperToken}/today.jpg`;
  const enabledWallpapers = user.wallpapers.filter(
    (wallpaper) => wallpaper.isEnabled,
  );
  const latestGenerated = user.generatedImages[0];
  const supabase = createSupabaseAdminClient();
  const bucket = getStorageBucket();
  const previewEntries = await Promise.all(
    user.wallpapers.map(async (wallpaper) => {
      const { data } = await supabase.storage
        .from(bucket)
        .createSignedUrl(wallpaper.storagePath, 60 * 60);

      return [wallpaper.id, data?.signedUrl ?? null] as const;
    }),
  );
  const previewByWallpaperId = new Map(previewEntries);

  return (
    <main className="min-h-screen bg-muted/30 px-3 py-4 text-foreground sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 sm:gap-6">
        <header className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm sm:p-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-normal">skedwall.</h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              signed in as {user.email}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start md:self-auto">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className={panelClass}>
            <p className="text-xs font-medium uppercase text-muted-foreground">calendar</p>
            <p className="mt-2 text-lg font-semibold">
              {hasCalendarAccess ? "connected" : "not connected"}
            </p>
            {!hasCalendarAccess ? <ReconnectGoogleButton /> : null}
          </div>
          <div className={panelClass}>
            <p className="text-xs font-medium uppercase text-muted-foreground">wallpapers</p>
            <p className="mt-2 text-lg font-semibold">{user.wallpapers.length}</p>
          </div>
          <div className={panelClass}>
            <p className="text-xs font-medium uppercase text-muted-foreground">enabled</p>
            <p className="mt-2 text-lg font-semibold">{enabledWallpapers.length}</p>
          </div>
          <div className={panelClass}>
            <p className="text-xs font-medium uppercase text-muted-foreground">generation</p>
            <p className="mt-2 text-lg font-semibold">
              {settings.generationEnabled ? "enabled" : "disabled"}
            </p>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
          <form action={updateSettings} className={panelClass}>
            <h2 className="text-lg font-semibold">settings</h2>
            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">timezone</span>
                <input
                  name="timezone"
                  defaultValue={settings.timezone}
                  className={fieldClass}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">max events</span>
                  <input
                    name="maxEvents"
                    type="number"
                    min="1"
                    max="6"
                    defaultValue={settings.maxEvents}
                    className={fieldClass}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">wallpaper mode</span>
                  <select
                    name="wallpaperMode"
                    defaultValue={settings.wallpaperMode}
                    className={fieldClass}
                  >
                    <option value={WallpaperMode.LATEST_UPLOADED}>latest uploaded</option>
                    <option value={WallpaperMode.SELECTED}>selected wallpaper</option>
                    <option value={WallpaperMode.RANDOM_DAILY}>random daily</option>
                  </select>
                </label>
              </div>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">selected wallpaper</span>
                <select
                  name="selectedWallpaperId"
                  defaultValue={settings.selectedWallpaperId ?? ""}
                  className={fieldClass}
                >
                  <option value="">none</option>
                  {enabledWallpapers.map((wallpaper) => (
                    <option key={wallpaper.id} value={wallpaper.id}>
                      {wallpaper.originalFilename ?? wallpaper.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  name="generationEnabled"
                  type="checkbox"
                  defaultChecked={settings.generationEnabled}
                  className="size-4 rounded border"
                />
                <span>daily generation enabled</span>
              </label>
              <div className="flex justify-center pt-1">
                <button
                  type="submit"
                  className="inline-flex w-full max-w-56 items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground sm:w-fit"
                >
                  save settings
                </button>
              </div>
            </div>
          </form>

          <div className="grid gap-5">
            <div className={panelClass}>
              <h2 className="text-lg font-semibold">shortcut url</h2>
              <p className="mt-4 break-all rounded-md border bg-muted p-3 text-sm leading-relaxed">
                {wallpaperUrl}
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-[auto_auto_1fr] sm:items-center">
                <CopyButton value={wallpaperUrl} label="copy url" />
                <ShortcutInstructions wallpaperUrl={wallpaperUrl} />
                <form action={regenerateWallpaperToken} className="sm:justify-self-end">
                  <button
                    type="submit"
                    className="w-full rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent sm:w-auto"
                  >
                    regenerate token
                  </button>
                </form>
              </div>
            </div>

            <div className={panelClass}>
              <div className="text-center sm:text-left">
                <h2 className="text-lg font-semibold">manual generate</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  uses your latest settings, current calendar, and selected wallpaper mode.
                </p>
              </div>
              <GenerateWallpaperForm disabled={enabledWallpapers.length === 0} />
              {latestGenerated ? (
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  latest: {latestGenerated.status.toLowerCase()} at{" "}
                  {latestGenerated.createdAt.toLocaleString()}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className={panelClass}>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">upload wallpaper</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                JPEG, PNG, or WebP. 10 MB max.
              </p>
            </div>
          </div>
          <UploadWallpaperForm />
        </section>

        <section className={panelClass}>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">wallpapers</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                small previews are signed for this dashboard session.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {user.wallpapers.length === 0 ? (
              <p className="text-sm text-muted-foreground">no wallpapers uploaded yet.</p>
            ) : (
              user.wallpapers.map((wallpaper) => {
                const previewUrl = previewByWallpaperId.get(wallpaper.id);

                return (
                  <div
                    key={wallpaper.id}
                    className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-[72px_1fr] sm:items-center"
                  >
                    <div
                      className="h-24 w-16 overflow-hidden rounded-md border bg-muted sm:h-28 sm:w-[72px]"
                      aria-label={wallpaper.originalFilename ?? "wallpaper preview"}
                      role="img"
                      style={
                        previewUrl
                          ? {
                              backgroundImage: `url(${previewUrl})`,
                              backgroundPosition: "center",
                              backgroundSize: "cover",
                            }
                          : undefined
                      }
                    />
                    <div className="min-w-0">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {wallpaper.originalFilename ?? wallpaper.id}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {wallpaper.mimeType} / {formatBytes(wallpaper.sizeBytes)} /{" "}
                            {wallpaper.isEnabled ? "enabled" : "disabled"}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                          <form action={setWallpaperEnabled}>
                            <input type="hidden" name="wallpaperId" value={wallpaper.id} />
                            <input
                              type="hidden"
                              name="isEnabled"
                              value={wallpaper.isEnabled ? "false" : "true"}
                            />
                            <button
                              type="submit"
                              className="w-full rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent sm:w-auto"
                            >
                              {wallpaper.isEnabled ? "disable" : "enable"}
                            </button>
                          </form>
                          <form action={deleteWallpaper}>
                            <input type="hidden" name="wallpaperId" value={wallpaper.id} />
                            <button
                              type="submit"
                              className="w-full rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent sm:w-auto"
                            >
                              delete
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}