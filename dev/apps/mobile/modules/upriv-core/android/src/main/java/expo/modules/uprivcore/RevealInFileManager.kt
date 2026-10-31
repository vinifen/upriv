package expo.modules.uprivcore

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.CodedException
import java.io.File

/**
 * Open a path the user already sees (data folder, import file, store ciphertext,
 * mount, or `content://` tree) in the system Files app.
 *
 * Encrypted vault bytes stay in `store/`. This only hands the Files app a
 * read-only view of an existing location.
 */
private const val SAF_LOGICAL_ROOT = "/upriv-saf-root"

internal fun revealInFileManager(context: Context, osPath: String) {
  val trimmed = osPath.trim()
  if (trimmed.isEmpty() || trimmed.any { it.code < 0x20 }) {
    throw RevealCodedException("open_path_failed", "path must be absolute")
  }
  if (trimmed.startsWith("content://", ignoreCase = true)) {
    // The data folder's grant can be Documents; the data folder is its `Upriv` child.
    val dataFolder =
      if (trimmed == SafPrefs.getActiveUri(context)?.trim()) {
        safDocumentForLogicalPath(context, SAF_LOGICAL_ROOT)
      } else {
        null
      }
    openContentDocument(context, dataFolder ?: Uri.parse(trimmed))
    return
  }
  if (!trimmed.startsWith("/")) {
    throw RevealCodedException("open_path_failed", "path must be absolute")
  }
  safDocumentForLogicalPath(context, trimmed)?.let { uri ->
    openContentDocument(context, uri)
    return
  }
  var current = File(trimmed)
  while (!current.exists()) {
    val parent = current.parentFile ?: throw RevealCodedException(
      "open_path_failed",
      "item is not on disk",
    )
    // `/upriv-saf-root` is not a real folder. Walking up to `/` opens the
    // phone's default files root instead of the vault folder.
    if (parent.absolutePath == "/") {
      throw RevealCodedException("open_path_failed", "item is not on disk")
    }
    current = parent
  }
  if (current.isDirectory) {
    openDirectory(context, current)
    return
  }
  openFile(context, current)
}

private fun shareableUri(context: Context, file: File): Uri {
  val authority = "${context.packageName}.uprivcore.fileprovider"
  try {
    return FileProvider.getUriForFile(context, authority, file)
  } catch (error: IllegalArgumentException) {
    throw RevealCodedException("open_path_failed", error.message ?: "path is not shareable")
  }
}

/**
 * `/upriv-saf-root/...` is the mounted data folder, not a filesystem path.
 * The Files app needs the storage-access document for that child.
 */
private fun safDocumentForLogicalPath(context: Context, path: String): Uri? {
  val normalized = path.trimEnd('/')
  if (normalized != SAF_LOGICAL_ROOT && !normalized.startsWith("$SAF_LOGICAL_ROOT/")) return null
  val tree = SafPrefs.getActiveUri(context)?.trim().orEmpty()
  if (!tree.startsWith("content://")) return null
  val parsed = Uri.parse(tree)
  val treeId = try {
    DocumentsContract.getTreeDocumentId(parsed)
  } catch (_: Throwable) {
    return null
  }
  val relative =
    if (normalized == SAF_LOGICAL_ROOT) "" else normalized.removePrefix("$SAF_LOGICAL_ROOT/")
  val underGrant = if (SafVaultRoot.isSharedDocumentsTree(tree)) {
    if (relative.isEmpty()) "Upriv" else "Upriv/$relative"
  } else {
    relative
  }
  val documentId = if (underGrant.isEmpty()) treeId else "$treeId/$underGrant"
  return DocumentsContract.buildDocumentUriUsingTree(parsed, documentId)
}

/**
 * The Files app opens a folder only from its plain document URI. Given a tree,
 * or a document addressed through a tree, it shows its own start screen.
 */
private fun plainDocumentUri(context: Context, uri: Uri): Uri {
  val documentId = try {
    when {
      DocumentsContract.isDocumentUri(context, uri) -> DocumentsContract.getDocumentId(uri)
      DocumentsContract.isTreeUri(uri) -> DocumentsContract.getTreeDocumentId(uri)
      else -> return uri
    }
  } catch (_: Throwable) {
    return uri
  }
  return DocumentsContract.buildDocumentUri(uri.authority, documentId)
}

private fun openContentDocument(context: Context, uri: Uri) {
  val mime = queryMime(context, uri)
  if (mime != null && mime != DocumentsContract.Document.MIME_TYPE_DIR) {
    // A viewer reads the file through this app's grant.
    startViewIntent(context, uri, mime)
    return
  }
  // The Files app browses the folder itself and needs no grant from this app.
  val folder = plainDocumentUri(context, uri)
  val attempts = listOf(
    DocumentsContract.Document.MIME_TYPE_DIR,
    "resource/folder",
    "vnd.android.document/directory",
  )
  var last: Exception? = null
  for (type in attempts) {
    try {
      startViewIntent(context, folder, type, grantRead = false)
      return
    } catch (error: Exception) {
      last = error
    }
  }
  throw RevealCodedException(
    "open_path_failed",
    last?.message ?: "no system file manager",
  )
}

private fun queryMime(context: Context, uri: Uri): String? {
  return try {
    context.contentResolver.query(
      uri,
      arrayOf(DocumentsContract.Document.COLUMN_MIME_TYPE),
      null,
      null,
      null,
    )?.use { cursor ->
      if (!cursor.moveToFirst()) return null
      val column = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
      if (column < 0) null else cursor.getString(column)
    }
  } catch (_: Throwable) {
    null
  }
}

private fun openDirectory(context: Context, dir: File) {
  val uri = shareableUri(context, dir)
  val attempts = listOf(
    DocumentsContract.Document.MIME_TYPE_DIR,
    "resource/folder",
    "vnd.android.document/directory",
  )
  var last: Exception? = null
  for (mime in attempts) {
    try {
      startViewIntent(context, uri, mime)
      return
    } catch (error: Exception) {
      last = error
    }
  }
  throw RevealCodedException(
    "open_path_failed",
    last?.message ?: "no system file manager",
  )
}

private fun openFile(context: Context, file: File) {
  val extension = file.extension.lowercase()
  val mime =
    MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "*/*"
  try {
    startViewIntent(context, shareableUri(context, file), mime)
  } catch (_: Exception) {
    val parent = file.parentFile
    if (parent != null) {
      openDirectory(context, parent)
      return
    }
    throw RevealCodedException("open_path_failed", "no system file manager")
  }
}

private fun startViewIntent(context: Context, uri: Uri, mime: String, grantRead: Boolean = true) {
  val intent = Intent(Intent.ACTION_VIEW).apply {
    setDataAndType(uri, mime)
    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (grantRead) addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
  }
  try {
    context.startActivity(intent)
  } catch (error: ActivityNotFoundException) {
    throw RevealCodedException("open_path_failed", error.message ?: "no system file manager")
  }
}

private class RevealCodedException(code: String, message: String) :
  CodedException(code, message, null)
