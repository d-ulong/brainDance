"use client";

import { useEffect, useState } from "react";

export type ThemeName = "space" | "candy";

const THEME_STORAGE_KEY = "braindance-theme";
const DEFAULT_THEME: ThemeName = "space";

function isThemeName(value: string | null): value is ThemeName {
  return value === "space" || value === "candy";
}

function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>(DEFAULT_THEME);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      const nextTheme = isThemeName(stored) ? stored : DEFAULT_THEME;
      setTheme(nextTheme);
      applyTheme(nextTheme);
    } catch {
      applyTheme(DEFAULT_THEME);
    }
  }, []);

  const nextTheme = theme === "space" ? "candy" : "space";
  const nextThemeLabel = nextTheme === "candy" ? "糖果游乐园" : "太空探险队";

  function toggleTheme() {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The current page still uses the selected theme when storage is unavailable.
    }
  }

  return (
    <button
      type="button"
      className="bd-theme-toggle"
      data-testid="theme-toggle"
      aria-label={`切换到${nextThemeLabel}`}
      onClick={toggleTheme}
    >
      <span aria-hidden>{theme === "space" ? "🪐" : "🍬"}</span>
      <span>{theme === "space" ? "换糖果主题" : "换太空主题"}</span>
    </button>
  );
}
