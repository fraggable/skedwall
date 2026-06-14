import { LogIn, LogOut, RefreshCw } from "lucide-react";

import { signIn, signOut } from "@/auth";

export function SignInButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: "/dashboard" });
      }}
    >
      <button
        type="submit"
        className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        <LogIn className="size-4" aria-hidden="true" />
        <span>sign in with google</span>
      </button>
    </form>
  );
}

export function ReconnectGoogleButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: "/dashboard" });
      }}
    >
      <button
        type="submit"
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        <span>reconnect calendar</span>
      </button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button
        type="submit"
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent"
      >
        <LogOut className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">sign out</span>
      </button>
    </form>
  );
}