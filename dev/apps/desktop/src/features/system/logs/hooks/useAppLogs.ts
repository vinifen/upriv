import { useCallback, useEffect, useRef, useState } from "react";
import { type AppLogFile, sortLogFilesNewestFirst } from "@upriv/shared";
import { useLogService } from "@/platform/services";

export function useAppLogs(open: boolean) {
  const logService = useLogService();
  const [files, setFiles] = useState<AppLogFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [contentByName, setContentByName] = useState<Record<string, string>>({});
  const loadGen = useRef(0);

  const reload = useCallback(async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    setLoadFailed(false);
    setLoadError(null);
    try {
      const list = await logService.listFiles();
      if (gen !== loadGen.current) return;
      setFiles(sortLogFilesNewestFirst(list));
      setContentByName({});
    } catch (error) {
      if (gen !== loadGen.current) return;
      setLoadFailed(true);
      setLoadError(error);
      // Keep previous `files` for transient failures; vault-root handlers clear/close.
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [logService]);

  /** Invalidate in-flight list/get so a budget timeout can clear the spinner. */
  const cancelLoading = useCallback(() => {
    loadGen.current += 1;
    setLoading(false);
  }, []);

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
    (filename: string): AppLogFile | undefined => {
      const entry = files.find((item) => item.filename === filename);
      if (!entry) return undefined;
      const content = contentByName[filename] ?? entry.content;
      return { ...entry, content };
    },
    [contentByName, files],
  );

  const loadFileContent = useCallback(
    async (filename: string): Promise<string> => {
      const cached = contentByName[filename];
      if (cached !== undefined) return cached;
      const existing = files.find((item) => item.filename === filename);
      if (existing?.content) {
        setContentByName((current) => ({ ...current, [filename]: existing.content }));
        return existing.content;
      }
      const gen = loadGen.current;
      const file = await logService.getFile(filename);
      if (gen !== loadGen.current) return "";
      if (!file) {
        throw new Error(`log file not found: ${filename}`);
      }
      const content = file.content;
      setContentByName((current) => ({ ...current, [filename]: content }));
      return content;
    },
    [contentByName, files, logService],
  );

  return {
    files,
    loading,
    loadFailed,
    loadError,
    deleteFiles,
    getFile,
    loadFileContent,
    reload,
    cancelLoading,
  };
}
