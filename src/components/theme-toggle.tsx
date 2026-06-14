"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect } from "react";

type Theme = "light" | "dark";

function getPreferredTheme(): Theme {
  const stored = window.localStorage.getItem("skedwall-theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.localStorage.setItem("skedwall-theme", theme);
}

export function ThemeToggle() {
  useEffect(() => {
    applyTheme(getPreferredTheme());
  }, []);

  function toggleTheme() {
    const nextTheme = document.documentElement.classList.contains("dark")
      ? "light"
      : "dark";

    applyTheme(nextTheme);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-background transition-colors hover:bg-accent"
      aria-label="toggle dark mode"
      title="Toggle theme"
    >
      <Moon className="size-4 dark:hidden" aria-hidden="true" />
      <Sun className="hidden size-4 dark:block" aria-hidden="true" />
    </button>
  );
}