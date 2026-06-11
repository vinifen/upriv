import type { FileTreeNode, MockFileContent } from "./fileTreeTypes";

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
  "dev-secrets": {
    name: "workspace",
    type: "folder",
    children: [
      { name: ".env.local", type: "file" },
      {
        name: "keys",
        type: "folder",
        children: [
          { name: "api-token.txt", type: "file" },
          { name: "ssh-config-notes.md", type: "file" },
        ],
      },
      {
        name: "scripts",
        type: "folder",
        children: [{ name: "rotate-secrets.sh", type: "file" }],
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
  "travel-planner": {
    name: "workspace",
    type: "folder",
    children: [
      { name: "itinerary.md", type: "file" },
      {
        name: "bookings",
        type: "folder",
        children: [
          { name: "flights.pdf", type: "file" },
          { name: "hotel-confirmation.txt", type: "file" },
        ],
      },
      {
        name: "packing",
        type: "folder",
        children: [{ name: "checklist.md", type: "file" }],
      },
    ],
  },
};

const CONTENTS: Record<string, Record<string, MockFileContent>> = {
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
  "dev-secrets": {
    "/.env.local": {
      language: "env",
      content: "UPRIV_MOCK=true\nAPI_BASE=https://api.example.test\n",
    },
    "/keys/api-token.txt": {
      language: "text",
      content: "mock-token-7f3a9c2b-rotate-quarterly\n",
    },
    "/keys/ssh-config-notes.md": {
      language: "markdown",
      content: "## Bastion\n\nHost jump uses ed25519 key in team vault.\n",
    },
    "/scripts/rotate-secrets.sh": {
      language: "shell",
      content:
        '#!/usr/bin/env bash\nset -euo pipefail\necho "Mock rotate — wire to upriv-core later"\n',
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
  "travel-planner": {
    "/itinerary.md": {
      language: "markdown",
      content:
        "# Trip — Lisbon\n\n| Day | Plan |\n|-----|------|\n| 1 | Arrive, check-in |\n| 2 | Alfama walk |\n",
    },
    "/bookings/flights.pdf": {
      language: "binary",
      content: "",
    },
    "/bookings/hotel-confirmation.txt": {
      language: "text",
      content: "Ref: UPRIV-MOCK-8842\nCheck-in: 14:00\n",
    },
    "/packing/checklist.md": {
      language: "markdown",
      content: "- Passport\n- Chargers\n- Offline maps\n",
    },
  },
};

export function getMockVaultFileTree(vaultId: string): FileTreeNode {
  return structuredClone(TREES[vaultId] ?? DEFAULT_WORKSPACE);
}

const DEFAULT_CONTENTS: Record<string, MockFileContent> = {
  "/welcome.txt": {
    language: "text",
    content: "Welcome to this vault workspace.\nOpen a file from the tree to preview it here.\n",
  },
  "/notes/scratch.md": {
    language: "markdown",
    content: "# Scratch\n\nTemporary notes while the vault is open.\n",
  },
};

export function getMockFileContent(vaultId: string, path: string): MockFileContent | null {
  return CONTENTS[vaultId]?.[path] ?? DEFAULT_CONTENTS[path] ?? null;
}
