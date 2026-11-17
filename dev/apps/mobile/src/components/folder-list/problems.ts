import type { RowProblem } from "@upriv/shared";
import type { I18nKey } from "@/i18n";

const PROBLEM_KEYS: Record<RowProblem, I18nKey> = {
  empty: "folder_list.problem.empty",
  not_absolute: "folder_list.problem.not_absolute",
  reserved: "folder_list.problem.reserved",
  overlap: "folder_list.problem.overlap",
  duplicate: "folder_list.problem.duplicate",
};

export function problemKey(problem: RowProblem): I18nKey {
  return PROBLEM_KEYS[problem];
}
