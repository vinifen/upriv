import { describe, expect, it } from "vitest";
import type { I18nParams } from "../../../i18n/types";
import {
  createdVaultText,
  pipelineCompleteText,
  unfinishedVaultsRemovedText,
} from "../completeToast";

const t = (key: string, params?: I18nParams) =>
  params ? `${key} ${Object.values(params).join(" ")}` : key;

const leftOut = (count: number) => ({ leftOut: count, stopped: false });

describe("createdVaultText", () => {
  it("says a create is ready, and counts what it left out", () => {
    expect(createdVaultText("Work", leftOut(0), t)).toBe("toast.pipeline_complete_create Work");
    expect(createdVaultText("Work", leftOut(1), t)).toBe(
      "toast.pipeline_complete_create_left_out_one Work",
    );
    expect(createdVaultText("Work", leftOut(3), t)).toBe(
      "toast.pipeline_complete_create_left_out Work 3",
    );
  });

  it("says a stopped create keeps what got in, whatever it left out", () => {
    expect(createdVaultText("Work", { leftOut: 2, stopped: true }, t)).toBe(
      "toast.pipeline_complete_create_stopped Work",
    );
  });
});

describe("pipelineCompleteText", () => {
  it("says an open or a close ended", () => {
    expect(pipelineCompleteText("open", "Work", t)).toBe("toast.pipeline_complete_open Work");
    expect(pipelineCompleteText("close", "Work", t)).toBe("toast.pipeline_complete_close Work");
  });
});

describe("unfinishedVaultsRemovedText", () => {
  it("names the one unfinished vault the sweep removed, and counts several", () => {
    expect(unfinishedVaultsRemovedText(["Work"], t)).toBe(
      "toast.unfinished_vault_removed_one Work",
    );
    expect(unfinishedVaultsRemovedText(["Work", "Photos"], t)).toBe(
      "toast.unfinished_vault_removed 2",
    );
  });
});
