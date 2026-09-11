package expo.modules.uprivcore

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import uniffi.upriv_ffi.appVersion
import uniffi.upriv_ffi.configureRuntime
import uniffi.upriv_ffi.invoke
import java.io.File

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

    AsyncFunction("invoke") { method: String, paramsJson: String ->
      ensureRuntimeConfigured()
      invoke(method, paramsJson)
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

    /** Release persistable permission — best-effort (missing perm is not an error). */
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
private class SafCodedException(code: String, message: String) : CodedException(code, message, null)
