import { useCallback, useEffect, useState } from "react";
import { type AppLogFile, sortLogFilesNewestFirst } from "@upriv/shared";
import { useLogService } from "@/platform/services";

export function useAppLogs(open: boolean) {
  const logService = useLogService();
  const [files, setFiles] = useState<AppLogFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<"error.logs_load_failed" | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErrorKey(null);
    try {
      const list = await logService.listFiles();
      setFiles(sortLogFilesNewestFirst(list));
    } catch {
      setFiles([]);
      setErrorKey("error.logs_load_failed");
    } finally {
      setLoading(false);
    }
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
    async (filename: string) => {
      const cached = files.find((entry) => entry.filename === filename);
      if (cached?.content) return cached;
      try {
        return await logService.getFile(filename);
      } catch {
        return undefined;
      }
    },
    [files, logService],
  );

  return { files, deleteFiles, getFile, reload, loading, errorKey };
}
