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
 * Open an existing OS path in the system Files app / a folder viewer.
 *
 * Encrypted vaults have no OS folder on Android (in-app file manager only).
 * This helper is for a real mount / `upriv_plain` workspace when one exists.
 */
internal fun revealInFileManager(context: Context, osPath: String) {
  val trimmed = osPath.trim()
  if (trimmed.isEmpty() || !(trimmed.startsWith("/") || trimmed.startsWith("content://"))) {
    throw RevealCodedException("open_path_failed", "path must be absolute")
  }
  if (trimmed.startsWith("content://")) {
    startViewIntent(context, Uri.parse(trimmed), DocumentsContract.Document.MIME_TYPE_DIR)
    return
  }
  var current = File(trimmed)
  while (!current.exists()) {
    val parent = current.parentFile ?: throw RevealCodedException(
      "open_path_failed",
      "item is not on disk",
    )
    if (parent == current) {
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
  return FileProvider.getUriForFile(context, authority, file)
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

private fun startViewIntent(context: Context, uri: Uri, mime: String) {
  val intent = Intent(Intent.ACTION_VIEW).apply {
    setDataAndType(uri, mime)
    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
  }
  try {
    context.startActivity(intent)
  } catch (error: ActivityNotFoundException) {
    throw RevealCodedException("open_path_failed", error.message ?: "no system file manager")
  }
}

private class RevealCodedException(code: String, message: String) :
  CodedException(code, message, null)
