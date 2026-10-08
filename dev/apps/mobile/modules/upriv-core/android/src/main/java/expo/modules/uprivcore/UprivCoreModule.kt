package expo.modules.uprivcore

import android.content.Context
import android.net.Uri
import android.os.ParcelFileDescriptor
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import uniffi.upriv_ffi.SafFsCallback
import uniffi.upriv_ffi.appVersion
import uniffi.upriv_ffi.configureRuntime
import uniffi.upriv_ffi.importContentFd
import uniffi.upriv_ffi.invoke
import uniffi.upriv_ffi.mountSafFs
import uniffi.upriv_ffi.probeSafFs
import uniffi.upriv_ffi.unmountSafFs

/**
 * Expo module wrapping UniFFI `upriv_ffi` (`libupriv_ffi.so`).
 *
 * Same CORE RPC surface as desktop `upriv-daemon` via `invoke(method, paramsJson)`.
 *
 * Before any Rust call we pin app home through UniFFI `configureRuntime`
 * (`UPRIV_DEFAULT_ROOT_ANCHOR` + `UPRIV_DISTRIBUTION=installed`) — Android has
 * no HOME / XDG_DATA_HOME; Electron sets the same env for the daemon on desktop.
 *
 * **SAF surface (`saf*` functions):** custom vault-root on Android goes through
 * SAF `content://` URIs, which Rust `std::fs` cannot address. `SafVaultRoot`
 * handles create / inspect / read / write on the SAF tree; TOML parsing +
 * serialization still happen in Rust via the pure `app_settings_*_toml` RPCs.
 * See `dev/docs/sdd.md` §9.4 for the Android SAF flow.
 */
class UprivCoreModule : Module() {
  @Volatile
  private var runtimeConfigured = false

  override fun definition() = ModuleDefinition {
    Name("UprivCore")

    OnCreate {
      // React context is often still null here. Pin UniFFI runtime on the first
      // Function / AsyncFunction instead of throwing during module registration.
    }

    Function("appVersion") {
      ensureRuntimeConfigured()
      appVersion()
    }

    /** Logical processors. The JS import pool uses this; Hermes has no `hardwareConcurrency`. */
    Function("processorCount") {
      Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
    }

    AsyncFunction("invoke") Coroutine { method: String, paramsJson: String ->
      ensureRuntimeConfigured()
      withContext(CoreLanes.dispatcher(method)) { invoke(method, paramsJson) }
    }

    // Long work leaves Expo's async thread. Probes stay on the IO pool so a
    // close-phase read is not queued behind either the light lane or a close.
    AsyncFunction("invokeProbe") Coroutine { method: String, paramsJson: String ->
      if (method !in PROBE_METHODS) {
        throw CodedException("ERR_UPRIV_PROBE_METHOD", "not a probe method: $method", null)
      }
      withContext(Dispatchers.IO) {
        ensureRuntimeConfigured()
        invoke(method, paramsJson)
      }
    }

    // ---- SAF (Android Storage Access Framework) ---------------------

    /**
     * Take persistable read/write permission for a `content://` tree URI so
     * the app can access it across restarts. Idempotent.
     */
    Function("safPersistPermission") { treeUri: String ->
      ensureRuntimeConfigured()
      runSafOrThrow { SafVaultRoot.persist(requireContext(), treeUri) }
    }

    /**
     * Document URI for the shared Documents directory.
     * Passed as the system screen's starting location so the user can confirm
     * it without browsing. This does not grant it. `Upriv` is created after.
     */
    Function("safDocumentsInitialUri") {
      SafVaultRoot.documentsUprivInitialUri()
    }

    /**
     * Release persistable permission — best-effort (missing perm is not an error).
     * Refuses to drop the currently active vault-root tree (import-folder).
     */
    Function("safReleasePermission") { treeUri: String ->
      ensureRuntimeConfigured()
      runSafOrThrow { SafVaultRoot.release(requireContext(), treeUri) }
    }

    /**
     * Inspect `.upriv/settings.toml` at the SAF tree.
     * Returns one of `"absent"|"valid"|"incomplete"|"unauthorized"|"unreadable"`
     * (mirrors Rust `VaultRootDirStatus` plus `unauthorized`).
     */
    Function("safInspectRoot") { treeUri: String ->
      ensureRuntimeConfigured()
      runSafOrThrow { SafVaultRoot.inspect(requireContext(), treeUri).wire() }
    }

    /**
     * Create `.upriv/settings.toml` + `{vaults,logs,app,runtime}/` at the SAF tree.
     *
     * `replacePolicy` is `null` (idempotent: keep settings, still ensure
     * `{vaults,logs,app,runtime}/` exist),
     * `"delete"` (wipe marker dir in place — SAF cannot recreate the same
     * display name after `DocumentFile.delete()`), or `"rename"` (`.upriv` →
     * `.upriv-invalidated-<stamp>`). Callers must only pass delete/rename when
     * the tree is incomplete — selecting a valid root should skip this RPC.
     */
    Function("safSetupRoot") {
        treeUri: String,
        locale: String?,
        settingsTomlOverride: String?,
        replacePolicy: String?,
      ->
      ensureRuntimeConfigured()
      runSafOrThrow {
        SafVaultRoot.setupRoot(
          requireContext(),
          treeUri,
          locale,
          settingsTomlOverride,
          replacePolicy,
        )
      }
    }

    /** Read `.upriv/settings.toml` body as UTF-8. Returns null when absent. */
    Function("safReadSettings") { treeUri: String ->
      ensureRuntimeConfigured()
      runSafOrThrow { SafVaultRoot.readSettings(requireContext(), treeUri) }
    }

    /**
     * Overwrite `.upriv/settings.toml` under the SAF tree. Requires `.upriv/`
     * to already exist — call `safSetupRoot` first (mirrors Rust
     * `write_settings_toml_only`, which refuses to recreate `.upriv`).
     */
    Function("safWriteSettings") { treeUri: String, contents: String ->
      ensureRuntimeConfigured()
      runSafOrThrow { SafVaultRoot.writeSettings(requireContext(), treeUri, contents) }
    }

    /**
     * Currently active SAF tree URI (empty string when SAF mode is inactive).
     * Stored in per-app SharedPreferences, outside the vault-root itself.
     */
    Function("safGetActiveUri") {
      ensureRuntimeConfigured()
      SafPrefs.getActiveUri(requireContext()) ?: ""
    }

    /** Save (or clear when blank) the active SAF tree URI. */
    Function("safSetActiveUri") { uri: String ->
      ensureRuntimeConfigured()
      SafPrefs.setActiveUri(requireContext(), uri)
    }

    /**
     * Point Rust `/upriv-saf-root` at this persisted tree. Sync so the next
     * vault RPC sees the mount. The callback must not call `invoke`.
     */
    Function("mountSafRoot") { uri: String ->
      ensureRuntimeConfigured()
      val trimmed = uri.trim()
      if (!trimmed.startsWith("content://")) {
        throw SafCodedException("saf_invalid_tree", "data folder must be a content tree")
      }
      val ctx = requireContext()
      runSafOrThrow {
        SafFs.bind(ctx, trimmed)
        mountSafFs(
          object : SafFsCallback {
            override fun dispatch(op: String, payload: String): String = SafFs.dispatch(op, payload)
          },
        )
        if (!probeSafFs()) {
          unmountSafFs()
          SafFs.clear()
          throw SafException("saf_not_ready", "chosen folder cannot store vaults")
        }
      }
    }

    /** Drop the Rust mount. The persistable grant stays until it is released. */
    Function("unmountSafRoot") {
      unmountSafFs()
      SafFs.clear()
    }

    /**
     * Open a user-visible filesystem path or `content://` tree in the system Files app.
     * Does not decrypt `store/`. Callers pass a location the UI already shows.
     */
    Function("revealInFileManager") { osPath: String ->
      revealInFileManager(requireContext(), osPath)
    }

    /**
     * Stream one `content://` document into the open import session.
     * Returns the UniFFI JSON envelope. Does not copy the file into app cache.
     */
    AsyncFunction("importContentUri") Coroutine { vaultId: String, logicalPath: String, contentUri: String ->
      ensureRuntimeConfigured()
      val context = requireContext()
      withContext(CoreLanes.importFiles) {
        streamContentUri(context, vaultId, logicalPath, contentUri)
      }
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw IllegalStateException("UprivCore: React context not ready")

  private inline fun <T> runSafOrThrow(block: () -> T): T {
    return try {
      block()
    } catch (error: SafException) {
      throw SafCodedException(error.code, error.message ?: error.code)
    } catch (error: SecurityException) {
      throw SafCodedException("saf_unauthorized", error.message ?: "SAF permission denied")
    }
  }

  private fun ensureRuntimeConfigured() {
    if (runtimeConfigured) return
    synchronized(this) {
      if (runtimeConfigured) return
      val ctx = requireContext()
      val home = File(ctx.filesDir, "upriv").apply { mkdirs() }
      // App-specific directory. Android deletes it on uninstall. It holds the
      // folder pointer only. The vault is the shared Documents/Upriv grant.
      // Single path: Rust owns the env pin (parity with Electron setting the same vars).
      configureRuntime(home.absolutePath, "installed")
      runtimeConfigured = true
    }
  }
}

/**
 * Expo `CodedException` — the JS side sees `{ code, message }` matching the
 * Rust `RpcError` shape, so mobile error handling stays uniform between
 * "TOML failure from Rust" and "SAF failure from Kotlin".
 */
/** Light, read-only RPCs that may run beside a long heavy call. */
private val PROBE_METHODS = setOf("vault_close_phase")

/**
 * Same lanes as the desktop daemon (`upriv-daemon` `wire.rs`), plus a light
 * lane for everything else. Argon2, close, and pack are one thread each.
 * File import uses up to two threads, the phone cap in `import_slots_for`.
 * A one-core phone uses one thread.
 *
 * Method names match `is_argon2_bound_method`, `is_lifecycle_io_method`,
 * `is_import_io_method`, and `is_pack_io_method`.
 */
private object CoreLanes {
  private fun single(name: String): CoroutineDispatcher =
    Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, name).apply { isDaemon = true }
    }.asCoroutineDispatcher()

  private val light = single("upriv-rpc")
  private val argon2 = single("upriv-argon2")
  private val lifecycle = single("upriv-fs-io")
  val pack = single("upriv-pack")
  private val importNames = AtomicInteger()
  val importFiles: CoroutineDispatcher =
    Executors.newFixedThreadPool(phoneImportThreads()) { runnable ->
      Thread(runnable, "upriv-import-${importNames.getAndIncrement()}").apply { isDaemon = true }
    }.asCoroutineDispatcher()

  /** Same cap as Rust `import_slots_for(cores, phone = true)`. One core stays one thread. */
  private fun phoneImportThreads(): Int {
    val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
    return (cores - 1).coerceIn(1, 2)
  }

  fun dispatcher(method: String): CoroutineDispatcher = when (method) {
    "vault_open", "vault_create", "vault_export_probe", "vault_ingest_open" -> argon2
    "vault_close", "vault_delete", "backup_get", "vault_discard_import" -> lifecycle
    "vault_fs_import_os_file", "vault_fs_import_seal" -> importFiles
    "vault_import_zip",
    "vault_import_7z",
    "vault_import_files_zip",
    "vault_import_os_path",
    "vault_export" -> pack
    else -> light
  }
}

private class SafCodedException(code: String, message: String) : CodedException(code, message, null)

private fun rpcError(code: String, message: String): String {
  val error = org.json.JSONObject()
  error.put("code", code)
  error.put("message", message)
  val envelope = org.json.JSONObject()
  envelope.put("ok", false)
  envelope.put("error", error)
  return envelope.toString()
}

private fun envelopeOk(raw: String): Boolean {
  return try {
    org.json.JSONObject(raw).optBoolean("ok", false)
  } catch (_: Exception) {
    false
  }
}

/**
 * Hand the content file to Rust as a file descriptor. A provider that cannot
 * open a descriptor is copied through a pipe, which holds only a small buffer.
 */
private fun streamContentUri(
  context: Context,
  vaultId: String,
  logicalPath: String,
  contentUri: String,
): String {
  val uri = Uri.parse(contentUri)
  val resolver = context.contentResolver
  val descriptor =
    try {
      resolver.openFileDescriptor(uri, "r")
    } catch (_: Exception) {
      null
    }
  if (descriptor != null) {
    val fd = descriptor.detachFd()
    descriptor.close()
    return importContentFd(vaultId, logicalPath, fd)
  }
  val input =
    try {
      resolver.openInputStream(uri)
    } catch (_: Exception) {
      return rpcError("import_source_unreadable", "could not read the import file")
    } ?: return rpcError("import_source_unreadable", "could not read the import file")
  val pipe =
    try {
      ParcelFileDescriptor.createPipe()
    } catch (_: Exception) {
      input.close()
      return rpcError("import_source_unreadable", "could not read the import file")
    }
  val readSide = pipe[0]
  val writeSide = pipe[1]
  val copyError = AtomicReference<Exception>(null)
  val writer =
    Thread {
      try {
        ParcelFileDescriptor.AutoCloseOutputStream(writeSide).use { out ->
          input.use { stream -> stream.copyTo(out, 256 * 1024) }
        }
      } catch (error: Exception) {
        copyError.set(error)
        runCatching { input.close() }
      }
    }
  writer.start()
  val readFd = readSide.detachFd()
  val imported =
    try {
      importContentFd(vaultId, logicalPath, readFd)
    } catch (_: Exception) {
      // Rust takes the descriptor only after this call is entered. Closing it
      // here unblocks the writer when the call never reached Rust.
      closeAbandonedImportFd(readFd)
      writer.join()
      return rpcError("import_source_unreadable", "could not read the import file")
    }
  writer.join()
  val failed = copyError.get()
  if (failed != null && envelopeOk(imported)) {
    // Closing the pipe is a normal end of file, so Rust stores the bytes it
    // already read. Drop that partial document before the batch seals it.
    discardPartialImport(vaultId, logicalPath)
    return rpcError("import_source_unreadable", "could not read the import file")
  }
  return imported
}

/** Remove a document staged from a pipe that closed early. */
private fun discardPartialImport(vaultId: String, logicalPath: String) {
  val params =
    org.json.JSONObject()
      .put("id", vaultId)
      .put("path", logicalPath)
      .toString()
  runCatching { invoke("vault_fs_delete", params) }
}

private fun closeAbandonedImportFd(fd: Int) {
  if (fd < 0) return
  try {
    ParcelFileDescriptor.adoptFd(fd).close()
  } catch (_: Exception) {
    /* already closed */
  }
}
