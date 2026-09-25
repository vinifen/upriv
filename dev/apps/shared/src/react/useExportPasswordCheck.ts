import { useCallback, useEffect, useRef, useState } from "react";
import { LOADING_BUDGET_MS, isLifecyclePasswordPresent } from "../domain";
import { useLoadingBudget } from "./useLoadingBudget";

export interface UseExportPasswordCheckOptions {
  open: boolean;
  vaultId: string | null;
  password: string;
  probe: (vaultId: string, password: string) => Promise<boolean>;
  onProbeError?: (error: unknown) => void;
}

/**
 * Argon2id check for a portable `.7z` password. Export stays blocked until
 * this exact password has unlocked the vault. A late answer after close,
 * timeout, or a typed change does not count.
 */
export function useExportPasswordCheck({
  open,
  vaultId,
  password,
  probe,
  onProbeError,
}: UseExportPasswordCheckOptions) {
  const [verifiedPassword, setVerifiedPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [passwordWrong, setPasswordWrong] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const genRef = useRef(0);
  const checkingRef = useRef(false);
  const passwordRef = useRef(password);
  const vaultIdRef = useRef(vaultId);
  const openRef = useRef(open);
  const probeRef = useRef(probe);
  const onProbeErrorRef = useRef(onProbeError);
  passwordRef.current = password;
  vaultIdRef.current = vaultId;
  openRef.current = open;
  probeRef.current = probe;
  onProbeErrorRef.current = onProbeError;

  const budget = useLoadingBudget(checking, LOADING_BUDGET_MS.vaultPipeline);
  const present = isLifecyclePasswordPresent(password);
  const passwordOk = present && password === verifiedPassword;

  useEffect(() => {
    genRef.current += 1;
    checkingRef.current = false;
    setChecking(false);
    setVerifiedPassword("");
    setPasswordWrong(false);
    setTimedOut(false);
  }, [open, vaultId]);

  useEffect(() => {
    if (!budget.timedOut || !checking) return;
    genRef.current += 1;
    checkingRef.current = false;
    setChecking(false);
    setTimedOut(true);
  }, [budget.timedOut, checking]);

  const check = useCallback(() => {
    const id = vaultIdRef.current;
    const attempt = passwordRef.current;
    if (!openRef.current || !id || checkingRef.current) return;
    if (!isLifecyclePasswordPresent(attempt)) return;
    const gen = ++genRef.current;
    checkingRef.current = true;
    setChecking(true);
    setPasswordWrong(false);
    setTimedOut(false);
    void probeRef
      .current(id, attempt)
      .then((ok) => {
        if (gen !== genRef.current) return;
        if (attempt !== passwordRef.current) return;
        if (ok) setVerifiedPassword(attempt);
        else setPasswordWrong(true);
      })
      .catch((error: unknown) => {
        if (gen !== genRef.current) return;
        if (attempt !== passwordRef.current) return;
        onProbeErrorRef.current?.(error);
      })
      .finally(() => {
        if (gen !== genRef.current) return;
        checkingRef.current = false;
        setChecking(false);
      });
  }, []);

  const notePasswordEdited = useCallback(() => {
    setPasswordWrong(false);
    setTimedOut(false);
  }, []);

  return {
    passwordOk,
    canCheck: present && !checking && !passwordOk,
    checking,
    passwordWrong,
    timedOut,
    budget,
    check,
    notePasswordEdited,
  };
}
