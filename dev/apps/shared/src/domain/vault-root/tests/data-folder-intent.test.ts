import { describe, expect, it } from "vitest";
import { dataFolderGate, DATA_FOLDER_GATE_IDLE } from "../dataFolderIntent";

const ok = (content: "valid" | "incomplete" | "empty" | "unreadable") => ({
  state: "ok" as const,
  content,
  details: null,
});

describe("dataFolderGate", () => {
  it("needs nothing when only the list changed", () => {
    expect(dataFolderGate({ switching: false, status: null, replacePolicy: null })).toEqual(
      DATA_FOLDER_GATE_IDLE,
    );
  });

  it("waits without attention while the check runs", () => {
    expect(dataFolderGate({ switching: true, status: null, replacePolicy: null })).toMatchObject({
      blocksPrimary: true,
      attention: false,
    });
  });

  it("waits with attention for a folder that does not answer", () => {
    const gate = dataFolderGate({
      switching: true,
      status: { state: "missing", content: null, details: null },
      replacePolicy: null,
    });
    expect(gate).toMatchObject({ blocksPrimary: true, attention: true });
    expect(gate.problem).toBe("folder_list.status.missing");
  });

  it("asks how to replace a broken data folder, then lets it go", () => {
    expect(
      dataFolderGate({ switching: true, status: ok("incomplete"), replacePolicy: null }),
    ).toMatchObject({ blocksPrimary: true, attention: true, needsReplacePolicy: true });
    const chosen = dataFolderGate({
      switching: true,
      status: ok("incomplete"),
      replacePolicy: "rename",
      primaryAction: "apply",
    });
    expect(chosen.blocksPrimary).toBe(false);
    expect(chosen.confirmNotes).toEqual(["modal.data_folder.apply_confirm_note.rename"]);
  });

  it("notes that an empty folder gets a data folder", () => {
    expect(
      dataFolderGate({ switching: true, status: ok("empty"), replacePolicy: null }),
    ).toMatchObject({
      blocksPrimary: false,
      confirmNotes: ["modal.vault_root_gate.continue_confirm_note.create"],
    });
    expect(dataFolderGate({ switching: true, status: ok("valid"), replacePolicy: null })).toEqual(
      DATA_FOLDER_GATE_IDLE,
    );
  });
});
