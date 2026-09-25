import type { FileTreeNode, VaultFileContent } from "../domain/file-tree";
import { cloneJson } from "./cloneJson";

const DEFAULT_WORKSPACE: FileTreeNode = {
  name: "workspace",
  type: "folder",
  children: [
    { name: "welcome.txt", type: "file" },
    {
      name: "notes",
      type: "folder",
      children: [{ name: "scratch.md", type: "file" }],
    },
  ],
};

const TREES: Record<string, FileTreeNode> = {
  "my-encrypted-notes": {
    name: "workspace",
    type: "folder",
    children: [
      { name: "README.md", type: "file" },
      {
        name: "notes",
        type: "folder",
        children: [
          { name: "daily.md", type: "file" },
          { name: "ideas.md", type: "file" },
        ],
      },
      {
        name: "drafts",
        type: "folder",
        children: [{ name: "letter.txt", type: "file" }],
      },
    ],
  },
  "work-documents": {
    name: "workspace",
    type: "folder",
    children: [
      {
        name: "contracts",
        type: "folder",
        children: [
          { name: "nda-2025.pdf", type: "file" },
          { name: "vendor-msa.pdf", type: "file" },
        ],
      },
      {
        name: "reports",
        type: "folder",
        children: [
          { name: "q1-summary.md", type: "file" },
          { name: "action-items.txt", type: "file" },
        ],
      },
    ],
  },
};

const CONTENTS: Record<string, Record<string, VaultFileContent>> = {
  "my-encrypted-notes": {
    "/README.md": {
      language: "markdown",
      content: "# My Encrypted Notes\n\nQuick capture while the vault is open.\n",
    },
    "/notes/daily.md": {
      language: "markdown",
      content: "## 2026-06-02\n\n- Finish file manager mock\n- Review backup policy\n",
    },
    "/notes/ideas.md": {
      language: "markdown",
      content: "## Ideas\n\n- Tag notes by project\n- Pin frequent folders\n",
    },
    "/drafts/letter.txt": {
      language: "text",
      content: "Dear team,\n\nSharing the updated roadmap draft.\n",
    },
  },
  "work-documents": {
    "/contracts/nda-2025.pdf": {
      language: "binary",
      content: "",
    },
    "/contracts/vendor-msa.pdf": {
      language: "binary",
      content: "",
    },
    "/reports/q1-summary.md": {
      language: "markdown",
      content: "# Q1 summary\n\nRevenue on track. Legal review pending for MSA.\n",
    },
    "/reports/action-items.txt": {
      language: "text",
      content: "- Send countersigned NDA\n- Archive receipts in Finance vault\n",
    },
  },
};

export function getMockVaultFileTree(vaultId: string): FileTreeNode {
  return cloneJson(TREES[vaultId] ?? DEFAULT_WORKSPACE);
}

const DEFAULT_CONTENTS: Record<string, VaultFileContent> = {
  "/welcome.txt": {
    language: "text",
    content: "Welcome to this vault workspace.\nOpen a file from the tree to preview it here.\n",
  },
  "/notes/scratch.md": {
    language: "markdown",
    content: "# Scratch\n\nTemporary notes while the vault is open.\n",
  },
};

export function getMockFileContent(vaultId: string, path: string): VaultFileContent | null {
  return CONTENTS[vaultId]?.[path] ?? DEFAULT_CONTENTS[path] ?? null;
}
