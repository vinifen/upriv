import { useCallback, useEffect, useState } from "react";
import { type AppLogFile, sortLogFilesNewestFirst } from "@upriv/shared";
import { useLogService } from "@/platform/services";

export function useAppLogs(open: boolean) {
  const logService = useLogService();
  const [files, setFiles] = useState<AppLogFile[]>([]);

  const reload = useCallback(async () => {
    const list = await logService.listFiles();
    setFiles(sortLogFilesNewestFirst(list));
  }, [logService]);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  const deleteFiles = useCallback(
    async (filenames: readonly string[]) => {
      if (filenames.length === 0) return;
      await logService.deleteFiles(filenames);
      await reload();
    },
    [logService, reload],
  );

  const getFile = useCallback(
    (filename: string) => files.find((entry) => entry.filename === filename),
    [files],
  );

  return { files, deleteFiles, getFile, reload };
}
