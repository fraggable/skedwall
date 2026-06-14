import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="grid gap-4">
        <h1 className="text-5xl font-bold">skedwall.</h1>
        <p className="text-lg text-muted-foreground">
          your daily iPhone wallpaper, generated from your calendar schedule.
        </p>
      </div>
      <Link
        href="/dashboard"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        open dashboard
      </Link>
    </main>
  );
}
