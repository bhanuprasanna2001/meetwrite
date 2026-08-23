import { useCallback, useEffect, useRef, useState } from "react";
import { clearKey, getKeyStatus, saveKey } from "../../../shared/api/sidecar";
import { log } from "../../../shared/lib/logger";

export function useApiKey() {
  const operationRef = useRef(0);
  const busyRef = useRef(false);
  const [keySet, setKeySet] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const operationId = ++operationRef.current;
    void getKeyStatus()
      .then((set) => {
        if (active && operationId === operationRef.current) setKeySet(set);
      })
      .catch((loadError) => {
        if (active && operationId === operationRef.current) setKeySet(null);
        log.warn("key.status_load_failed", undefined, loadError);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (key: string): Promise<boolean> => {
    const trimmed = key.trim();
    if (!trimmed || busyRef.current) return false;
    busyRef.current = true;
    const operationId = ++operationRef.current;
    setBusy(true);
    setError(null);
    try {
      await saveKey(trimmed);
      if (operationId !== operationRef.current) return false;
      setKeySet(true);
      return true;
    } catch (saveError) {
      if (operationId === operationRef.current) setError("The API key could not be saved.");
      log.error("key.save_failed", undefined, saveError);
      return false;
    } finally {
      busyRef.current = false;
      if (operationId === operationRef.current) setBusy(false);
    }
  }, []);

  const remove = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    const operationId = ++operationRef.current;
    setBusy(true);
    setError(null);
    try {
      await clearKey();
      if (operationId !== operationRef.current) return false;
      setKeySet(false);
      return true;
    } catch (removeError) {
      if (operationId === operationRef.current) setError("The API key could not be cleared.");
      log.error("key.clear_failed", undefined, removeError);
      return false;
    } finally {
      busyRef.current = false;
      if (operationId === operationRef.current) setBusy(false);
    }
  }, []);

  return { keySet, busy, error, save, remove };
}
