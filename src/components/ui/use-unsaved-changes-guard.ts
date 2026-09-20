"use client";

import { useEffect, useRef } from "react";

const GUARD_KEY = "__bdUnsavedGuard";

function readHistoryState(): Record<string, unknown> {
  const state = window.history.state;
  if (state && typeof state === "object" && !Array.isArray(state)) {
    return { ...(state as Record<string, unknown>) };
  }
  return {};
}

function hasGuard(state: unknown): boolean {
  return typeof state === "object" && state !== null && GUARD_KEY in state;
}

function withGuard(state: Record<string, unknown>) {
  return { ...state, [GUARD_KEY]: 1 };
}

function withoutGuard(state: Record<string, unknown>) {
  const next = { ...state };
  delete next[GUARD_KEY];
  return next;
}

export function useUnsavedChangesGuard(active: boolean) {
  const activeRef = useRef(active);
  const trapArmed = useRef(false);
  const leavingConfirmed = useRef(false);
  const collapsingTrap = useRef(false);
  activeRef.current = active;

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!activeRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function armTrap() {
      const base = readHistoryState();
      if (hasGuard(window.history.state)) {
        trapArmed.current = true;
        return;
      }
      if (trapArmed.current) {
        window.history.replaceState(withGuard(base), "");
        return;
      }
      window.history.pushState(withGuard(base), "");
      trapArmed.current = true;
    }

    function disarmTrap() {
      if (!trapArmed.current) return;
      if (!hasGuard(window.history.state)) {
        trapArmed.current = false;
        return;
      }
      collapsingTrap.current = true;
      window.history.back();
    }

    function onPopState(event: PopStateEvent) {
      if (collapsingTrap.current) {
        collapsingTrap.current = false;
        trapArmed.current = false;
        const base = readHistoryState();
        if (hasGuard(event.state)) {
          window.history.replaceState(withoutGuard(base), "");
        }
        return;
      }

      if (leavingConfirmed.current) {
        leavingConfirmed.current = false;
        trapArmed.current = false;
        return;
      }

      if (!activeRef.current) {
        if (hasGuard(event.state)) {
          window.history.replaceState(withoutGuard(readHistoryState()), "");
        }
        return;
      }

      const leave = window.confirm("有未保存的修改，确定离开吗？");
      if (leave) {
        leavingConfirmed.current = true;
        trapArmed.current = false;
        activeRef.current = false;
        window.history.back();
        return;
      }

      window.history.pushState(withGuard(readHistoryState()), "");
      trapArmed.current = true;
    }

    if (active) {
      armTrap();
    } else {
      disarmTrap();
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
    };
  }, [active]);
}
