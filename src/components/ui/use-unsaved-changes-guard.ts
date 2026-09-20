"use client";

import { useEffect, useRef } from "react";

const HISTORY_GUARD = { __bdUnsavedGuard: 1 } as const;

export function useUnsavedChangesGuard(active: boolean) {
  const guardPushed = useRef(false);
  const confirmingLeave = useRef(false);
  const suppressPop = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) {
      confirmingLeave.current = false;
      if (guardPushed.current) {
        guardPushed.current = false;
        suppressPop.current = true;
        window.history.back();
      }
      return;
    }

    suppressPop.current = false;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    function onPopState() {
      if (suppressPop.current && !activeRef.current) {
        suppressPop.current = false;
        return;
      }
      suppressPop.current = false;
      if (confirmingLeave.current) {
        confirmingLeave.current = false;
        return;
      }
      if (!activeRef.current) {
        return;
      }
      const leave = window.confirm("有未保存的修改，确定离开吗？");
      if (leave) {
        confirmingLeave.current = true;
        guardPushed.current = false;
        window.history.back();
        return;
      }
      window.history.pushState(HISTORY_GUARD, "");
      guardPushed.current = true;
    }

    if (!guardPushed.current) {
      window.history.pushState(HISTORY_GUARD, "");
      guardPushed.current = true;
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
    };
  }, [active]);
}
