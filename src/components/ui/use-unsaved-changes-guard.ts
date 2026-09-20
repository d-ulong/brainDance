"use client";

import { useEffect, useRef } from "react";

const HISTORY_GUARD = { __bdUnsavedGuard: 1 } as const;

function isGuardState(state: unknown): boolean {
  return typeof state === "object" && state !== null && "__bdUnsavedGuard" in state;
}

export function useUnsavedChangesGuard(active: boolean) {
  const trapArmed = useRef(false);
  const leavingConfirmed = useRef(false);
  const skipPop = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!activeRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function armTrap() {
      if (isGuardState(window.history.state)) return;
      if (trapArmed.current) {
        window.history.replaceState(HISTORY_GUARD, "");
        return;
      }
      window.history.pushState(HISTORY_GUARD, "");
      trapArmed.current = true;
    }

    function disarmTrap() {
      if (!trapArmed.current) return;
      if (isGuardState(window.history.state)) {
        window.history.replaceState(null, "");
      }
    }

    function onPopState(event: PopStateEvent) {
      if (leavingConfirmed.current) {
        leavingConfirmed.current = false;
        trapArmed.current = false;
        return;
      }

      if (skipPop.current) {
        skipPop.current = false;
        return;
      }

      if (isGuardState(event.state) && !activeRef.current) {
        window.history.replaceState(null, "");
        return;
      }

      if (!activeRef.current) {
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

      window.history.pushState(HISTORY_GUARD, "");
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
