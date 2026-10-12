package expo.modules.uprivcore

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import java.io.File

/**
 * Android SAF helper for the Upriv **vault-root** folder.
 *
 * Grants, the picker's initial folder, and read-only probes of a picked
 * `content://` tree. Every write (setup, settings, vaults) goes through Rust
 * on the mounted [SafFs] bridge. See SDD §9.4 / ARCHITECTURE §6.
 *
 * Marker directory: `.upriv/` only (desktop parity).
 */
internal object SafVaultRoot {
  private const val TAG = "UprivSaf"

  const val UPRIV_DIR = ".upriv"
  const val SETTINGS_FILE = "settings.toml"

  enum class Status {
    Absent,
    Valid,
    Incomplete,
    Unauthorized,
    Unreadable,
    /** Grant is held, but the volume does not answer. */
    Unreachable;

    fun wire(): String = when (this) {
      Absent -> "absent"
      Valid -> "valid"
      Incomplete -> "incomplete"
      Unauthorized -> "unauthorized"
      Unreadable -> "unreadable"
      Unreachable -> "unreachable"
    }
  }

  /**
   * Document URI for the shared Documents directory.
   *
   * The picker must open on a folder that already exists. `Documents/Upriv`
   * often does not, and the system then lands on a location where the user
   * cannot confirm. Confirming Documents is the one step; `Upriv` is created
   * inside that grant.
   */
  fun documentsUprivInitialUri(): String {
    return DocumentsContract.buildDocumentUri(
      "com.android.externalstorage.documents",
      "primary:Documents",
    ).toString()
  }

  /** True when the persisted tree is the shared Documents directory itself. */
  fun isSharedDocumentsTree(treeUri: String): Boolean {
    val id = try {
      DocumentsContract.getTreeDocumentId(Uri.parse(treeUri)).trimEnd('/')
    } catch (_: Throwable) {
      return false
    }
    return id == "primary:Documents" || id == "home:Documents"
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

  /**
   * Same `ACTION_OPEN_DOCUMENT_TREE` grant — encoding and a `/document/` leaf
   * must not look like a different tree (import-folder vs vault-root).
   */
  fun sameTreeUri(left: String, right: String): Boolean {
    val a = left.trim()
    val b = right.trim()
    if (a.isEmpty() || b.isEmpty()) return false
    if (a == b) return true
    val ua = Uri.parse(a)
    val ub = Uri.parse(b)
    if (ua == ub) return true
    return try {
      ua.authority == ub.authority &&
        DocumentsContract.getTreeDocumentId(ua) == DocumentsContract.getTreeDocumentId(ub)
    } catch (_: Throwable) {
      false
    }
  }

  fun hasGrant(context: Context, treeUri: String): Boolean =
    context.contentResolver.persistedUriPermissions.any {
      it.isReadPermission && it.isWritePermission && sameTreeUri(it.uri.toString(), treeUri)
    }

  fun release(context: Context, treeUri: String) {
    val active = SafPrefs.getActiveUri(context)
    if (!active.isNullOrBlank() && sameTreeUri(active, treeUri)) {
      // File-manager import must not drop the custom vault-root grant.
      return
    }
    val remembered = rememberedCustomUri(context)
    if (!remembered.isNullOrBlank() && sameTreeUri(remembered, treeUri)) {
      // The default Documents folder must not drop the last custom grant.
      return
    }
    val uri = Uri.parse(treeUri)
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    try {
      context.contentResolver.releasePersistableUriPermission(uri, flags)
    } catch (_: SecurityException) {
      // already gone
    }
  }

  /** `custom=` in the app-home `.upriv-root`. Missing file means nothing to keep. */
  private fun rememberedCustomUri(context: Context): String? {
    val file = File(context.filesDir, "upriv/.upriv-root")
    if (!file.isFile) return null
    return try {
      file.useLines { lines ->
        lines
          .firstOrNull { it.startsWith("custom=") }
          ?.removePrefix("custom=")
          ?.trim()
          ?.takeIf { it.startsWith("content://") }
      }
    } catch (_: Throwable) {
      null
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

  /** Find `.upriv` under the vault folder. Leading-dot names often skip `findFile`. */
  private fun findUprivDir(context: Context, tree: DocumentFile, treeUri: String): DocumentFile? {
    val parent = if (isSharedDocumentsTree(treeUri)) {
      childByDocumentId(context, treeUri, "Upriv")
        ?: tree.findFile("Upriv")?.takeIf { it.isDirectory }
    } else {
      tree
    } ?: return null
    parent.findFile(UPRIV_DIR)?.takeIf { it.isDirectory }?.let { return it }
    val relative = if (isSharedDocumentsTree(treeUri)) "Upriv/$UPRIV_DIR" else UPRIV_DIR
    return childByDocumentId(context, treeUri, relative)
  }

  private fun findSettingsFile(
    context: Context,
    treeUri: String,
    upriv: DocumentFile,
  ): DocumentFile? {
    upriv.findFile(SETTINGS_FILE)?.takeIf { !it.isDirectory }?.let { return it }
    val dirName = upriv.name ?: UPRIV_DIR
    val nested = if (isSharedDocumentsTree(treeUri)) "Upriv/$UPRIV_DIR/$SETTINGS_FILE" else "$UPRIV_DIR/$SETTINGS_FILE"
    return childByDocumentId(context, treeUri, "$dirName/$SETTINGS_FILE")?.takeIf { !it.isDirectory }
      ?: childByDocumentId(context, treeUri, nested)?.takeIf { !it.isDirectory }
  }

  fun inspect(context: Context, treeUri: String): Status {
    if (!SafFs.isReachable(context, treeUri)) {
      return if (hasGrant(context, treeUri)) Status.Unreachable else Status.Unauthorized
    }
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

  fun readSettings(context: Context, treeUri: String): String? {
    val tree = openTree(context, treeUri)
    val upriv = findUprivDir(context, tree, treeUri) ?: return null
    val settings = findSettingsFile(context, treeUri, upriv) ?: return null
    val bytes = readAllBytes(context, settings.uri) ?: return null
    return String(bytes, Charsets.UTF_8)
  }

  private fun readAllBytes(context: Context, uri: Uri): ByteArray? {
    return context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
  }
}

internal class SafException(val code: String, message: String) : RuntimeException(message)
