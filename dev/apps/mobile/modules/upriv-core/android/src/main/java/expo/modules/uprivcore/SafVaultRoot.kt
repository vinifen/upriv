package expo.modules.uprivcore

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import androidx.documentfile.provider.DocumentFile

/**
 * Android SAF helper for the Upriv **vault-root** folder.
 *
 * Rust speaks `std::fs::Path`; custom roots picked via
 * `ACTION_OPEN_DOCUMENT_TREE` are `content://` URIs and live here instead
 * (DocumentFile + ContentResolver). See SDD §9.4 / ARCHITECTURE §6.
 *
 * Marker directory: prefer `.upriv/` (desktop parity). Some OEM document
 * providers reject leading-dot display names — we fall back to `upriv/` and
 * accept either on inspect/read/write.
 */
internal object SafVaultRoot {
  private const val TAG = "UprivSaf"

  const val UPRIV_DIR = ".upriv"
  /** Fallback when the provider refuses a leading-dot folder name. */
  const val UPRIV_DIR_FALLBACK = "upriv"
  const val SETTINGS_FILE = "settings.toml"
  const val WORKSPACE_DIR = "workspace"

  private val UPRIV_CHILD_DIRS = listOf("vaults", "logs", "app", "runtime")
  private const val DEFAULT_LOCALE = "en"

  private const val DEFAULT_SETTINGS_TOML_TEMPLATE = """# Upriv marker + app settings (vault-root directory)

[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"
workspace_dir = "workspace"

[ui]
locale = "__LOCALE__"
theme = "dark"
vault_list_sort = "order"
vault_list_sort_direction = "asc"
vault_list_view = "default"
always_show_hidden_vaults = false
file_manager_dock_expanded = false

[logging]
enabled = true
level = "info"
entries_per_file = 1000
keep_last_entries = 10000

[app]
"""

  enum class Status {
    Absent,
    Valid,
    Incomplete,
    Unauthorized,
    Unreadable;

    fun wire(): String = when (this) {
      Absent -> "absent"
      Valid -> "valid"
      Incomplete -> "incomplete"
      Unauthorized -> "unauthorized"
      Unreadable -> "unreadable"
    }
  }

  fun persist(context: Context, treeUri: String) {
    val uri = Uri.parse(treeUri)
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    try {
      context.contentResolver.takePersistableUriPermission(uri, flags)
    } catch (error: SecurityException) {
      // Expo's picker already took persistable permission in many builds; a
      // second take can throw if the grant shape differs. Keep going if the
      // tree is still openable.
      Log.w(TAG, "takePersistableUriPermission: ${error.message}")
      if (DocumentFile.fromTreeUri(context, uri) == null) throw error
    }
  }

  fun release(context: Context, treeUri: String) {
    val uri = Uri.parse(treeUri)
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    try {
      context.contentResolver.releasePersistableUriPermission(uri, flags)
    } catch (_: SecurityException) {
      // already gone
    }
  }

  private fun openTree(context: Context, treeUri: String): DocumentFile {
    val uri = Uri.parse(treeUri)
    val tree = DocumentFile.fromTreeUri(context, uri)
      ?: throw SafException(
        "saf_unauthorized",
        "cannot open SAF tree (pick the folder again): $treeUri",
      )
    if (!tree.exists() || !tree.isDirectory) {
      throw SafException("saf_invalid_tree", "SAF URI is not a directory: $treeUri")
    }
    return tree
  }

  private fun documentLooksReal(context: Context, uri: Uri): Boolean {
    return try {
      context.contentResolver
        .query(
          uri,
          arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID),
          null,
          null,
          null,
        )?.use { it.count > 0 } == true
    } catch (_: Throwable) {
      false
    }
  }

  /**
   * Resolve a child under the tree by document id.
   * `DocumentFile.findFile` / `exists()` skip leading-dot names on Download
   * and media trees even when the folder is already on disk.
   */
  private fun childByDocumentId(
    context: Context,
    treeUri: String,
    relativePath: String,
  ): DocumentFile? {
    val parsed = Uri.parse(treeUri)
    val treeId =
      try {
        DocumentsContract.getTreeDocumentId(parsed)
      } catch (_: Throwable) {
        return null
      }
    val uri = DocumentsContract.buildDocumentUriUsingTree(parsed, "$treeId/$relativePath")
    if (!documentLooksReal(context, uri)) return null
    return DocumentFile.fromSingleUri(context, uri)
  }

  /** Find `.upriv` or fallback `upriv` under the tree root. */
  private fun findUprivDir(context: Context, tree: DocumentFile, treeUri: String): DocumentFile? {
    tree.findFile(UPRIV_DIR)?.takeIf { it.isDirectory }?.let { return it }
    tree.findFile(UPRIV_DIR_FALLBACK)?.takeIf { it.isDirectory }?.let { return it }
    // fromSingleUri.isDirectory is often false for tree children — trust the query.
    childByDocumentId(context, treeUri, UPRIV_DIR)?.let { return it }
    return childByDocumentId(context, treeUri, UPRIV_DIR_FALLBACK)
  }

  private fun findSettingsFile(
    context: Context,
    treeUri: String,
    upriv: DocumentFile,
  ): DocumentFile? {
    upriv.findFile(SETTINGS_FILE)?.takeIf { !it.isDirectory }?.let { return it }
    val dirName = upriv.name ?: UPRIV_DIR
    return childByDocumentId(context, treeUri, "$dirName/$SETTINGS_FILE")?.takeIf { !it.isDirectory }
      ?: childByDocumentId(context, treeUri, "$UPRIV_DIR/$SETTINGS_FILE")?.takeIf { !it.isDirectory }
      ?: childByDocumentId(context, treeUri, "$UPRIV_DIR_FALLBACK/$SETTINGS_FILE")
        ?.takeIf { !it.isDirectory }
  }

  /**
   * Create a child directory. `DocumentFile.createDirectory` returns null on
   * several providers (media collections, leading-dot names); fall back to
   * `DocumentsContract.createDocument` and then a find-by-name reuse.
   */
  private fun createChildDirectory(
    context: Context,
    parent: DocumentFile,
    name: String,
  ): DocumentFile? {
    parent.createDirectory(name)?.takeIf { it.exists() && it.isDirectory }?.let { return it }
    parent.findFile(name)?.takeIf { it.isDirectory }?.let { return it }
    return try {
      DocumentsContract.createDocument(
        context.contentResolver,
        parent.uri,
        DocumentsContract.Document.MIME_TYPE_DIR,
        name,
      ) ?: return null
      parent.findFile(name)?.takeIf { it.isDirectory }
    } catch (error: Throwable) {
      Log.w(TAG, "createDocument($name): ${error.message}")
      parent.findFile(name)?.takeIf { it.isDirectory }
    }
  }

  /**
   * Create `.upriv/` (or `upriv/` fallback). Media trees (Music, DCIM, …) often
   * reject a leading-dot name — try the un-dotted fallback before failing.
   */
  private fun createUprivDir(context: Context, tree: DocumentFile, treeUri: String): DocumentFile {
    findUprivDir(context, tree, treeUri)?.let { return it }

    for (name in listOf(UPRIV_DIR, UPRIV_DIR_FALLBACK)) {
      createChildDirectory(context, tree, name)?.let { return it }
    }

    // Create reported failure but the folder may already exist (hidden listing).
    findUprivDir(context, tree, treeUri)?.let { return it }

    throw SafException(
      "saf_create_failed",
      "cannot create .upriv/ (or upriv/) under the chosen folder",
    )
  }

  /** Empty a directory in place. Returns false if any child could not be removed. */
  private fun wipeDirectoryContents(dir: DocumentFile): Boolean {
    if (!dir.isDirectory) return false
    var ok = true
    for (child in dir.listFiles()) {
      if (!deleteRecursively(child)) ok = false
    }
    return ok
  }

  /**
   * Delete policy on SAF: wipe children and **reuse** the marker directory.
   * `DocumentFile.delete()` + `createDirectory(same name)` fails on several
   * providers (ExternalStorage / Music trees).
   */
  private fun emptyMarkerForReuse(marker: DocumentFile): DocumentFile {
    if (!wipeDirectoryContents(marker)) {
      throw SafException("saf_create_failed", "cannot delete incomplete .upriv/ under SAF tree")
    }
    return marker
  }

  private fun renameMarker(marker: DocumentFile): DocumentFile? {
    val stamp = System.currentTimeMillis()
    val baseName = marker.name ?: UPRIV_DIR
    val invalidated = if (baseName.startsWith(".")) {
      ".upriv-invalidated-$stamp"
    } else {
      "upriv-invalidated-$stamp"
    }
    if (marker.renameTo(invalidated)) return null
    Log.w(TAG, "renameTo($invalidated) failed — emptying marker in place")
    return emptyMarkerForReuse(marker)
  }

  fun inspect(context: Context, treeUri: String): Status {
    val tree = try {
      openTree(context, treeUri)
    } catch (error: SafException) {
      return if (error.code == "saf_unauthorized") Status.Unauthorized else Status.Unreadable
    } catch (_: SecurityException) {
      return Status.Unauthorized
    } catch (_: Throwable) {
      return Status.Unreadable
    }

    val upriv = findUprivDir(context, tree, treeUri) ?: return Status.Absent
    val settings = findSettingsFile(context, treeUri, upriv) ?: return Status.Incomplete
    if (settings.isDirectory) return Status.Incomplete
    return try {
      val bytes = readAllBytes(context, settings.uri) ?: return Status.Unreadable
      if (String(bytes, Charsets.UTF_8).trim().isEmpty()) Status.Incomplete else Status.Valid
    } catch (_: SecurityException) {
      Status.Unauthorized
    } catch (_: Throwable) {
      Status.Unreadable
    }
  }

  fun setupRoot(
    context: Context,
    treeUri: String,
    locale: String?,
    settingsTomlOverride: String?,
    replacePolicy: String?,
  ) {
    // Best-effort persist — Expo usually already persisted on pick.
    try {
      persist(context, treeUri)
    } catch (error: SecurityException) {
      Log.w(TAG, "persist before setup: ${error.message}")
    }

    val tree = openTree(context, treeUri)
    // Some trees (Music / emulator SAF) report canWrite()=false but still
    // accept createDocument. Only fail after the create attempt.
    if (!tree.canWrite()) {
      Log.w(TAG, "canWrite() is false for $treeUri — attempting create anyway")
    }

    var upriv = findUprivDir(context, tree, treeUri)
    val existingSettings = upriv?.let { findSettingsFile(context, treeUri, it) }
    val hasNonEmptySettings = if (existingSettings != null) {
      val bytes = try {
        readAllBytes(context, existingSettings.uri) ?: ByteArray(0)
      } catch (_: Throwable) {
        ByteArray(0)
      }
      String(bytes, Charsets.UTF_8).trim().isNotEmpty()
    } else {
      false
    }

    val policy = replacePolicy?.trim().orEmpty()
    when (policy) {
      "", "null" -> {
        if (hasNonEmptySettings) {
          // Idempotent: selecting an already-seeded tree is a no-op here.
          return
        }
      }
      "delete" -> {
        val marker = upriv
        if (marker != null) {
          upriv = emptyMarkerForReuse(marker)
        }
      }
      "rename" -> {
        val marker = upriv
        if (marker != null) {
          upriv = renameMarker(marker)
        }
      }
      else -> throw SafException(
        "invalid_request",
        "replacePolicy must be delete or rename",
      )
    }

    val marker = upriv?.takeIf { it.exists() && it.isDirectory } ?: createUprivDir(context, tree, treeUri)

    UPRIV_CHILD_DIRS.forEach { name ->
      val existing = marker.findFile(name)
      if (existing == null || !existing.isDirectory) {
        createChildDirectory(context, marker, name)
          ?: Log.w(TAG, "could not create .upriv/$name")
      }
    }
    if (tree.findFile(WORKSPACE_DIR)?.isDirectory != true) {
      createChildDirectory(context, tree, WORKSPACE_DIR)
        ?: Log.w(TAG, "could not create workspace/")
    }

    val toml = settingsTomlOverride ?: buildDefaultSettingsToml(locale)
    val settingsFile = findSettingsFile(context, treeUri, marker)
      ?: run {
        marker.createFile("application/octet-stream", SETTINGS_FILE)
          ?: marker.createFile("text/plain", SETTINGS_FILE)
          ?: throw SafException("saf_create_failed", "cannot create $SETTINGS_FILE under .upriv/")
      }
    writeDocumentBytes(context, marker, settingsFile, toml.toByteArray(Charsets.UTF_8))
  }

  private fun deleteRecursively(file: DocumentFile): Boolean {
    if (file.isDirectory) {
      for (child in file.listFiles()) {
        if (!deleteRecursively(child)) return false
      }
    }
    return file.delete()
  }

  fun readSettings(context: Context, treeUri: String): String? {
    val tree = openTree(context, treeUri)
    val upriv = findUprivDir(context, tree, treeUri) ?: return null
    val settings = findSettingsFile(context, treeUri, upriv) ?: return null
    val bytes = readAllBytes(context, settings.uri) ?: return null
    return String(bytes, Charsets.UTF_8)
  }

  fun writeSettings(context: Context, treeUri: String, contents: String) {
    val tree = openTree(context, treeUri)
    val upriv = findUprivDir(context, tree, treeUri)
      ?: throw SafException("vault_root_not_found", ".upriv/ missing under SAF tree $treeUri")
    val settingsFile = findSettingsFile(context, treeUri, upriv)
      ?: upriv.createFile("application/octet-stream", SETTINGS_FILE)
      ?: upriv.createFile("text/plain", SETTINGS_FILE)
      ?: throw SafException("saf_create_failed", "cannot create $SETTINGS_FILE under .upriv/")
    writeDocumentBytes(context, upriv, settingsFile, contents.toByteArray(Charsets.UTF_8))
  }

  private fun readAllBytes(context: Context, uri: Uri): ByteArray? {
    return context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
  }

  /**
   * Truncating write. Prefer `"wt"` / `"rwt"`; if the provider only accepts `"w"`
   * (no truncate), delete + recreate the document so leftover TOML is not kept.
   */
  private fun writeDocumentBytes(
    context: Context,
    parent: DocumentFile,
    file: DocumentFile,
    bytes: ByteArray,
  ) {
    val resolver = context.contentResolver
    for (mode in listOf("wt", "rwt")) {
      try {
        val out = resolver.openOutputStream(file.uri, mode)
        if (out != null) {
          out.use {
            it.write(bytes)
            it.flush()
          }
          return
        }
      } catch (error: Throwable) {
        Log.w(TAG, "openOutputStream($mode): ${error.message}")
      }
    }

    val displayName = file.name ?: SETTINGS_FILE
    if (!file.delete()) {
      Log.w(TAG, "could not delete $displayName before rewrite")
    }
    val created =
      parent.createFile("application/octet-stream", displayName)
        ?: parent.createFile("text/plain", displayName)
        ?: throw SafException("saf_create_failed", "cannot recreate $SETTINGS_FILE under .upriv/")
    val out =
      try {
        resolver.openOutputStream(created.uri, "w")
      } catch (error: Throwable) {
        Log.w(TAG, "openOutputStream(w) after recreate: ${error.message}")
        null
      } ?: try {
        resolver.openOutputStream(created.uri)
      } catch (error: Throwable) {
        Log.w(TAG, "openOutputStream(default) after recreate: ${error.message}")
        null
      } ?: throw SafException("saf_write_failed", "openOutputStream returned null for ${created.uri}")
    out.use {
      it.write(bytes)
      it.flush()
    }
  }

  private fun buildDefaultSettingsToml(locale: String?): String {
    val effective = locale?.trim()?.takeIf { it.isNotEmpty() } ?: DEFAULT_LOCALE
    if (effective.any { it == '"' || it == '\\' || it.isISOControl() }) {
      throw SafException(
        "invalid_request",
        "locale contains characters not allowed in settings.toml",
      )
    }
    return DEFAULT_SETTINGS_TOML_TEMPLATE.replace("__LOCALE__", effective)
  }
}

internal class SafException(val code: String, message: String) : RuntimeException(message)
