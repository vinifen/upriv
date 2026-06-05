import { useCallback, useEffect, useState } from "react";
import { getMockLogFiles } from "./mockLogs";
import type { AppLogFile } from "./logTypes";

export function useAppLogs(open: boolean) {
  const [files, setFiles] = useState<AppLogFile[]>([]);

  useEffect(() => {
    if (!open) return;
    setFiles(getMockLogFiles());
  }, [open]);

  const deleteFiles = useCallback((filenames: readonly string[]) => {
    if (filenames.length === 0) return;
    const remove = new Set(filenames);
    setFiles((current) => current.filter((entry) => !remove.has(entry.filename)));
  }, []);

  const getFile = useCallback(
    (filename: string) => files.find((entry) => entry.filename === filename),
    [files],
  );

  return { files, deleteFiles, getFile };
}
