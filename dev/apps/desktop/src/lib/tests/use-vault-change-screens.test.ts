/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RpcError, VAULT_ERROR_CODES, type VaultStorage } from "@upriv/shared";
import {
  useVaultChangeScreens,
  type StorageChangeOutcome,
  type UseVaultChangeScreensOptions,
} from "@upriv/shared/react";

const ENCRYPTED: VaultStorage = { mode: "encrypted_dir", plain_files: "chosen" };
const PLAIN: VaultStorage = { mode: "upriv_plain", plain_files: "chosen" };

/** Options for a closed vault `notes` whose window shows `area`. */
function options(over: Partial<UseVaultChangeScreensOptions> = {}): UseVaultChangeScreensOptions {
  return {
    open: true,
    vaultId: "notes",
    area: "storage",
    vaultListStatus: "closed",
    unlockPreset: "256mib",
    storage: ENCRYPTED,
    passwordChangeUnfinished: false,
    passwordChange: {
      job: null,
      outcome: null,
      change: vi.fn(() => true),
      finish: vi.fn(() => true),
      stop: vi.fn(),
    },
    unlockRamChange: { job: null, outcome: null, change: vi.fn(() => true), stop: vi.fn() },
    storageChange: { job: null, outcome: null, change: vi.fn(() => true), stop: vi.fn() },
    t: (key) => key,
    errorKey: () => "error.settings_save_failed",
    notice: vi.fn(),
    dismissConfirm: vi.fn(),
    onChanged: vi.fn(),
    ...over,
  };
}

function render(initial: UseVaultChangeScreensOptions) {
  return renderHook((props: UseVaultChangeScreensOptions) => useVaultChangeScreens(props), {
    initialProps: initial,
  });
}

function storageOutcome(over: Partial<StorageChangeOutcome>): StorageChangeOutcome {
  return {
    vaultId: "notes",
    storage: PLAIN,
    seq: 1,
    result: null,
    error: null,
    stopped: false,
    ...over,
  };
}

const WRONG_PASSWORD = new RpcError(VAULT_ERROR_CODES.WRONG_PASSWORD, "wrong");

describe("useVaultChangeScreens", () => {
  it("names no screen for the preferences, and the one the window shows otherwise", () => {
    const { result, rerender } = render(options({ area: "preferences" }));
    expect(result.current.active).toBeNull();
    rerender(options({ area: "kdf" }));
    expect(result.current.active?.area).toBe("kdf");
    rerender(options({ area: "kdf", open: false }));
    expect(result.current.active).toBeNull();
  });

  it("starts Storage from the copy and submits only a different choice with a password", () => {
    const opts = options();
    const { result, rerender } = render(opts);
    expect(result.current.storage.fields).toEqual({ password: "", storage: ENCRYPTED });
    expect(result.current.storage.dirty).toBe(false);

    act(() => result.current.storage.edit({ password: "pw" }));
    expect(result.current.storage.dirty).toBe(true);
    expect(result.current.storage.canSubmit).toBe(false);

    act(() => result.current.storage.edit({ storage: PLAIN }));
    expect(result.current.storage.canSubmit).toBe(true);
    expect(opts.dismissConfirm).toHaveBeenCalled();

    rerender({ ...opts, vaultListStatus: "open" });
    expect(result.current.storage.canSubmit).toBe(false);
    rerender(opts);
    act(() => result.current.storage.submit());
    expect(opts.storageChange.change).toHaveBeenCalledWith("notes", "pw", PLAIN);
    expect(opts.notice).not.toHaveBeenCalled();
  });

  it("says another change runs when the list refuses to start one", () => {
    const opts = options();
    opts.storageChange.change = vi.fn(() => false);
    const { result } = render(opts);
    act(() => result.current.storage.edit({ password: "pw", storage: PLAIN }));
    act(() => result.current.storage.submit());
    expect(opts.notice).toHaveBeenCalledWith("vault.change_storage.busy");
  });

  it("keeps a refused password on its field until that field is edited", () => {
    const opts = options();
    const { result, rerender } = render(opts);
    act(() => result.current.storage.edit({ password: "pw", storage: PLAIN }));
    rerender({
      ...opts,
      storageChange: {
        ...opts.storageChange,
        outcome: storageOutcome({ error: WRONG_PASSWORD }),
      },
    });
    expect(result.current.storage.passwordFieldError).not.toBeNull();
    expect(result.current.storage.formError).toBeNull();
    expect(result.current.storage.fields?.storage).toEqual(PLAIN);

    act(() => result.current.storage.edit({ storage: ENCRYPTED }));
    expect(result.current.storage.passwordFieldError).not.toBeNull();
    act(() => result.current.storage.edit({ password: "pw2" }));
    expect(result.current.storage.passwordFieldError).toBeNull();
  });

  it("shows any other failure on the form, and clears it with any edit", () => {
    const opts = options();
    const { result, rerender } = render(opts);
    act(() => result.current.storage.edit({ password: "pw", storage: PLAIN }));
    rerender({
      ...opts,
      storageChange: { ...opts.storageChange, outcome: storageOutcome({ error: new Error("x") }) },
    });
    expect(result.current.storage.formError).toBe("error.settings_save_failed");
    act(() => result.current.storage.edit({ storage: ENCRYPTED }));
    expect(result.current.storage.formError).toBeNull();
  });

  it("empties the form after a change is made, reports it, and hands the window the value", () => {
    const opts = options();
    const { result, rerender } = render(opts);
    act(() => result.current.storage.edit({ password: "pw", storage: PLAIN }));
    rerender({
      ...opts,
      storageChange: {
        ...opts.storageChange,
        outcome: storageOutcome({ result: { storage: PLAIN } }),
      },
    });
    expect(opts.onChanged).toHaveBeenCalledWith({
      area: "storage",
      vaultId: "notes",
      storage: PLAIN,
    });
    expect(result.current.storage.report).not.toBeNull();
    rerender({ ...opts, storage: PLAIN });
    expect(result.current.storage.fields).toEqual({ password: "", storage: PLAIN });
  });

  it("reports nothing to the window when it shows another vault", () => {
    const opts = options({ vaultId: "other" });
    const { result, rerender } = render(opts);
    rerender({
      ...opts,
      storageChange: {
        ...opts.storageChange,
        outcome: storageOutcome({ result: { storage: PLAIN } }),
      },
    });
    expect(opts.onChanged).not.toHaveBeenCalled();
    expect(result.current.storage.report).toBeNull();
  });

  it("keeps the form of a running change when the window closes, and empties it otherwise", () => {
    const opts = options();
    const { result, rerender } = render(opts);
    act(() => result.current.storage.edit({ password: "pw", storage: PLAIN }));
    const job = {
      vaultId: "notes",
      storage: PLAIN,
      id: "job-1",
      startedAt: 1,
      progress: null,
      stoppingSince: null,
    };
    const running = { ...opts, storageChange: { ...opts.storageChange, job } };
    rerender(running);
    expect(result.current.storage.job).toEqual(job);
    expect(result.current.storage.labelKey).toBe("vault.change_storage.submitting");
    rerender({ ...running, open: false });
    rerender(running);
    expect(result.current.storage.fields?.password).toBe("pw");

    rerender({ ...opts, open: false });
    rerender(opts);
    expect(result.current.storage.fields?.password).toBe("");
  });

  it("starts a password change only once the confirmation matches", () => {
    const opts = options({ area: "password" });
    const { result } = render(opts);
    act(() =>
      result.current.password.edit({
        currentPassword: "old-pass-word",
        newPassword: "new-pass-word-1",
        confirmPassword: "new-pass-word-2",
      }),
    );
    expect(result.current.password.canSubmit).toBe(false);
    act(() => result.current.password.submit());
    expect(opts.passwordChange.change).not.toHaveBeenCalled();

    act(() => result.current.password.edit({ confirmPassword: "new-pass-word-1" }));
    act(() => result.current.password.setBackUpFirst(false));
    act(() => result.current.password.submit());
    expect(opts.passwordChange.change).toHaveBeenCalledWith(
      "notes",
      "old-pass-word",
      "new-pass-word-1",
      false,
    );
  });

  it("opens an unfinished change on Finish, and starts Finish with its password", () => {
    const opts = options({ area: "password", passwordChangeUnfinished: true });
    const { result } = render(opts);
    expect(result.current.password.mode).toBe("finish");
    expect(result.current.password.labelKey).toBe("vault.change_password.finish");
    expect(result.current.password.confirmKey).toBe("modal.settings.area.password_finish_confirm");
    act(() => result.current.password.editFinishPassword("new-pass-word"));
    expect(result.current.password.dirty).toBe(true);
    act(() => result.current.password.submit());
    expect(opts.passwordChange.finish).toHaveBeenCalledWith("notes", "new-pass-word");
    act(() => result.current.password.toggleMode());
    expect(result.current.password.mode).toBe("change");
  });

  it("starts Unlock RAM from the header's cost and waits for another cost", () => {
    const opts = options({ area: "kdf" });
    const { result } = render(opts);
    expect(result.current.kdf.fields).toEqual({ password: "", nextPreset: "256mib" });
    act(() => result.current.kdf.edit({ password: "pw" }));
    expect(result.current.kdf.canSubmit).toBe(false);
    act(() => result.current.kdf.edit({ nextPreset: "1gib" }));
    expect(result.current.kdf.canSubmit).toBe(true);
    act(() => result.current.kdf.submit());
    expect(opts.unlockRamChange.change).toHaveBeenCalledWith("notes", "pw", "1gib");
  });
});
