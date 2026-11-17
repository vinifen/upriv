package expo.modules.uprivcore

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import androidx.documentfile.provider.DocumentFile

/**
 * Android storage-access grants for the folders Upriv uses: the data folder,
 * Default's Documents grant, and every picked tree.
 *
 * Grants and the picker's initial folder only. Every read and write of a
 * tree (setup, settings, vaults) goes through Rust on the mounted [SafFs]
 * bridge. See SDD §9.4 / ARCHITECTURE §6.
 */
internal object SafVaultRoot {
  private const val TAG = "UprivSaf"

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

  private fun treeId(treeUri: String): String? =
    try {
      DocumentsContract.getTreeDocumentId(Uri.parse(treeUri)).trimEnd('/')
    } catch (_: Throwable) {
      null
    }

  /** True when the persisted tree is the shared Documents directory itself. */
  fun isSharedDocumentsTree(treeUri: String): Boolean {
    val id = treeId(treeUri)
    return id == "primary:Documents" || id == "home:Documents"
  }

  /** Documents itself, or the `Upriv` folder inside it: what Default uses. */
  private fun isDocumentsDefaultTree(treeUri: String): Boolean {
    val id = treeId(treeUri)
    return id == "primary:Documents" ||
      id == "home:Documents" ||
      id == "primary:Documents/Upriv" ||
      id == "home:Documents/Upriv"
  }

  /**
   * The grant Default lives in: a held read/write grant on Documents or on
   * Documents/Upriv, Documents first. Empty when the phone holds neither yet.
   */
  fun documentsGrant(context: Context): String {
    val held =
      context.contentResolver.persistedUriPermissions
        .filter { it.isReadPermission && it.isWritePermission }
        .map { it.uri.toString() }
        .filter { isDocumentsDefaultTree(it) }
    return held.firstOrNull { isSharedDocumentsTree(it) } ?: held.firstOrNull() ?: ""
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

  /**
   * Drop a grant the person's pick took. The data folder in use, Default's
   * Documents grant, and a tree mounted for Rust keep theirs.
   */
  fun release(context: Context, treeUri: String) {
    val dataFolder = SafFs.boundTree()
    if (dataFolder.isNotBlank() && sameTreeUri(dataFolder, treeUri)) return
    if (isDocumentsDefaultTree(treeUri)) return
    if (SafTrees.isMounted(treeUri)) return
    val uri = Uri.parse(treeUri)
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    try {
      context.contentResolver.releasePersistableUriPermission(uri, flags)
    } catch (_: SecurityException) {
      // already gone
    }
  }
}

internal class SafException(val code: String, message: String) : RuntimeException(message)
