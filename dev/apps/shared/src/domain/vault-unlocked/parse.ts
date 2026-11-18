import { parseFolderState, parseSwitches } from "../folder-lists";
import { parseFolderClass } from "../vault-plain/parse";
import type { UnlockedDestination } from "./types";

/** `vault_unlocked_destination`'s answer, or `null` when it is not one. */
export function parseUnlockedDestination(raw: unknown): UnlockedDestination | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  switch (body.outcome) {
    case "off":
    case "unset":
      return { outcome: body.outcome };
    case "folder":
      if (typeof body.path !== "string" || body.path.length === 0) return null;
      return {
        outcome: "folder",
        path: body.path,
        class: parseFolderClass(body.class),
        switches: parseSwitches(body.switches),
      };
    case "unavailable":
      if (typeof body.path !== "string") return null;
      return { outcome: "unavailable", path: body.path, reason: parseFolderState(body.reason) };
    default:
      return null;
  }
}
