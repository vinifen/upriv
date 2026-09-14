import { describe, expect, it } from "vitest";
import {
  changeKdfFormCanSubmit,
  changeKdfFormIsDirty,
  changeKdfFormIsDowngrade,
  changePasswordFormCanSubmit,
  changePasswordFormIsDirty,
} from "../forms";

describe("changeKdfFormIsDirty", () => {
  it("is dirty when the password is filled or the preset changes", () => {
    expect(
      changeKdfFormIsDirty({
        password: "",
        nextPreset: "256mib",
        currentPreset: "256mib",
      }),
    ).toBe(false);
    expect(
      changeKdfFormIsDirty({
        password: "x",
        nextPreset: "256mib",
        currentPreset: "256mib",
      }),
    ).toBe(true);
    expect(
      changeKdfFormIsDirty({
        password: "",
        nextPreset: "1gib",
        currentPreset: "256mib",
      }),
    ).toBe(true);
  });
});

describe("changeKdfFormCanSubmit", () => {
  it("requires password, closed vault, and a different preset", () => {
    expect(
      changeKdfFormCanSubmit({
        password: "secret",
        nextPreset: "1gib",
        currentPreset: "256mib",
        vaultListStatus: "closed",
      }),
    ).toBe(true);
    expect(
      changeKdfFormCanSubmit({
        password: "secret",
        nextPreset: "256mib",
        currentPreset: "256mib",
        vaultListStatus: "closed",
      }),
    ).toBe(false);
    expect(
      changeKdfFormCanSubmit({
        password: "secret",
        nextPreset: "1gib",
        currentPreset: "256mib",
        vaultListStatus: "open",
      }),
    ).toBe(false);
    expect(
      changeKdfFormCanSubmit({
        password: "secret",
        nextPreset: "1gib",
        currentPreset: "256mib",
        vaultListStatus: "recovery",
      }),
    ).toBe(false);
    expect(
      changeKdfFormCanSubmit({
        password: "",
        nextPreset: "1gib",
        currentPreset: "256mib",
        vaultListStatus: "closed",
      }),
    ).toBe(false);
  });
});

describe("changeKdfFormIsDowngrade", () => {
  it("flags weaker presets only", () => {
    expect(changeKdfFormIsDowngrade("2gib", "256mib")).toBe(true);
    expect(changeKdfFormIsDowngrade("256mib", "1gib")).toBe(false);
    expect(changeKdfFormIsDowngrade("256mib", "256mib")).toBe(false);
  });
});

describe("changePasswordFormIsDirty", () => {
  it("is dirty when any password field is filled", () => {
    expect(
      changePasswordFormIsDirty({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      }),
    ).toBe(false);
    expect(
      changePasswordFormIsDirty({
        currentPassword: "x",
        newPassword: "",
        confirmPassword: "",
      }),
    ).toBe(true);
    expect(
      changePasswordFormIsDirty({
        currentPassword: "",
        newPassword: "y",
        confirmPassword: "",
      }),
    ).toBe(true);
    expect(
      changePasswordFormIsDirty({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "z",
      }),
    ).toBe(true);
  });
});

describe("changePasswordFormCanSubmit", () => {
  it("requires current, matching new, and a different password", () => {
    expect(
      changePasswordFormCanSubmit({
        currentPassword: "old",
        newPassword: "new-secret",
        confirmPassword: "new-secret",
        vaultListStatus: "closed",
      }),
    ).toBe(true);
    expect(
      changePasswordFormCanSubmit({
        currentPassword: "",
        newPassword: "new-secret",
        confirmPassword: "new-secret",
        vaultListStatus: "closed",
      }),
    ).toBe(false);
    expect(
      changePasswordFormCanSubmit({
        currentPassword: "old",
        newPassword: "new-secret",
        confirmPassword: "other",
        vaultListStatus: "closed",
      }),
    ).toBe(false);
    expect(
      changePasswordFormCanSubmit({
        currentPassword: "same",
        newPassword: "same",
        confirmPassword: "same",
        vaultListStatus: "closed",
      }),
    ).toBe(false);
    expect(
      changePasswordFormCanSubmit({
        currentPassword: "old",
        newPassword: "new-secret",
        confirmPassword: "new-secret",
        vaultListStatus: "closed",
        submitting: true,
      }),
    ).toBe(false);
    expect(
      changePasswordFormCanSubmit({
        currentPassword: "old",
        newPassword: "new-secret",
        confirmPassword: "new-secret",
        vaultListStatus: "open",
      }),
    ).toBe(false);
    expect(
      changePasswordFormCanSubmit({
        currentPassword: "old",
        newPassword: "new-secret",
        confirmPassword: "new-secret",
        vaultListStatus: "recovery",
      }),
    ).toBe(false);
  });
});
