// src/hooks/useUnitSystem.js
//
// React hook that returns the current unit-system preference and a
// setter, and re-renders subscribed components when the preference
// changes (so the toggle in Settings instantly updates every display).

import { useEffect, useState, useCallback } from "react";
import { getUnitSystem, setUnitSystem as persist } from "@/lib/unitSystem";

export function useUnitSystem() {
  const [system, setSystemState] = useState(() => getUnitSystem());

  useEffect(() => {
    const onChange = () => setSystemState(getUnitSystem());
    window.addEventListener("mq-unit-system-changed", onChange);
    // Cross-tab sync: storage event fires when another tab changes
    // localStorage.
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("mq-unit-system-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const set = useCallback((next) => {
    persist(next);
    setSystemState(next);
  }, []);

  return [system, set];
}
