import type { AppLogFile } from "./logTypes";
import { logCreatedAtFromFilename } from "./logFormat";

const ARCHIVED_CONTENT = `0001 2026-05-29T12:00:00.010Z INFO  app_start          version=0.2.0-demo vaults=4
0002 2026-05-29T12:00:00.120Z INFO  vault_discovered   vault=my-encrypted-notes persistence=closed
0003 2026-05-29T12:00:00.125Z INFO  vault_discovered   vault=vault-example-2 persistence=sealed
0004 2026-05-29T12:00:00.130Z INFO  vault_discovered   vault=cold-storage persistence=sealed
0005 2026-05-29T12:00:00.135Z INFO  vault_discovered   vault=plain-folder-demo persistence=closed
0006 2026-05-29T12:01:15.402Z INFO  vault_open         vault=my-encrypted-notes storage_mode=encrypted_dir
0007 2026-05-29T12:01:18.900Z INFO  vault_open         vault=plain-folder-demo storage_mode=plain security_mode=disk_open_close
0008 2026-05-29T12:05:22.110Z WARN  vault_auto_close   vault=my-encrypted-notes idle_minutes=15 warn_seconds=60
0009 2026-05-29T12:05:52.330Z INFO  vault_close        vault=my-encrypted-notes action=close archive_mode=encrypt_only
0010 2026-05-29T12:06:01.004Z DEBUG seven_zip_create   vault=my-encrypted-notes duration_ms=842`;

const CURRENT_CONTENT = `0001 2026-05-29T20:00:00.010Z INFO  app_start          version=0.2.0-demo vaults=4
0002 2026-05-29T20:00:00.090Z INFO  settings_loaded    locale=en theme=dark logging=info
0003 2026-05-29T20:00:00.120Z INFO  vault_discovered   vault=my-encrypted-notes persistence=closed
0004 2026-05-29T20:00:00.125Z INFO  vault_discovered   vault=vault-example-2 persistence=sealed
0005 2026-05-29T20:02:44.501Z INFO  vault_open         vault=my-encrypted-notes storage_mode=encrypted_dir
0006 2026-05-29T20:08:12.880Z WARN  policy_copy_block  vault=my-encrypted-notes path=/tmp blocked=true
0007 2026-05-29T20:15:03.220Z ERROR archive_test_failed vault=finance-2025 reason=wrong_password aborted=true
0008 2026-05-29T20:15:03.225Z INFO  vault_close_aborted vault=finance-2025
0009 2026-05-29T20:18:40.010Z DEBUG fuse_mount         vault=my-encrypted-notes mount=workspace/My Encrypted Notes`;

function buildEntry(
  filename: string,
  content: string,
  opts: { seq: number; isCurrent: boolean },
): AppLogFile {
  const lines = content.trimEnd().split("\n");
  const createdAt = logCreatedAtFromFilename(filename) ?? new Date().toISOString();
  return {
    filename,
    seq: opts.seq,
    isCurrent: opts.isCurrent,
    createdAt,
    sizeBytes: new TextEncoder().encode(content).length,
    lineCount: lines.length,
    content,
  };
}

const MOCK_LOG_FILES: AppLogFile[] = [
  buildEntry("000001-20260529120000.log", ARCHIVED_CONTENT, { seq: 1, isCurrent: false }),
  buildEntry("current-000002-20260529200000.log", CURRENT_CONTENT, { seq: 2, isCurrent: true }),
];

export function getMockLogFiles(): AppLogFile[] {
  return MOCK_LOG_FILES.map((entry) => ({ ...entry }));
}

export function getMockLogFile(filename: string): AppLogFile | undefined {
  return getMockLogFiles().find((entry) => entry.filename === filename);
}
