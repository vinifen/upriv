package expo.modules.uprivcore

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONArray
import org.json.JSONObject

/**
 * Storage-access filesystem for the mounted data folder.
 *
 * Rust addresses that folder as `/upriv-saf-root`. This object turns each
 * relative path into a document under the persisted tree and hands Rust a
 * detached file descriptor. Nothing is copied into app storage.
 */
internal object SafFs {
  private const val TAG = "UprivSafFs"
  private const val MIME_DIR = DocumentsContract.Document.MIME_TYPE_DIR
  private const val MIME_FILE = "application/octet-stream"

  private val treeUri = AtomicReference("")

  /** Documents just created. Listings often omit a leading-dot name. */
  private val remembered = ConcurrentHashMap<String, Node>()

  /**
   * One directory listing per parent, used when `parentId/name` is not the
   * provider's document id. Direct query stays first so a hit does not scan.
   */
  private val childIndex = ConcurrentHashMap<String, Map<String, Node>>()

  @Volatile
  private var appContext: Context? = null

  private val gate = Any()

  fun bind(context: Context, uri: String) {
    synchronized(gate) {
      appContext = context.applicationContext
      remembered.clear()
      childIndex.clear()
      treeUri.set(uri.trim())
    }
  }

  fun clear() {
    synchronized(gate) {
      remembered.clear()
      childIndex.clear()
      treeUri.set("")
    }
  }

  fun dispatch(op: String, payload: String): String =
    synchronized(gate) { dispatchLocked(op, payload) }

  private fun dispatchLocked(op: String, payload: String): String {
    return try {
      val context = appContext ?: return err("permission_denied", "data folder is not mounted")
      val tree = treeUri.get().trim()
      if (!tree.startsWith("content://")) {
        return err("permission_denied", "data folder is not mounted")
      }
      val json = if (payload.isBlank()) JSONObject() else JSONObject(payload)
      when (op) {
        "stat" -> stat(context, tree, json.optString("rel"))
        "mkdir" -> mkdir(context, tree, json.optString("rel"))
        "remove_file" -> remove(context, tree, json.optString("rel"), recursive = false, directory = false)
        "remove_dir" -> remove(context, tree, json.optString("rel"), recursive = false, directory = true)
        "remove_dir_all" -> remove(context, tree, json.optString("rel"), recursive = true, directory = true)
        "rename" -> rename(context, tree, json.optString("from"), json.optString("to"))
        "list" -> list(context, tree, json.optString("rel"))
        "open" -> open(context, tree, json)
        else -> err("other", "unknown data folder operation")
      }
    } catch (error: SecurityException) {
      err("permission_denied", error.message ?: "permission denied")
    } catch (error: Throwable) {
      Log.w(TAG, "$op failed", error)
      err("other", error.message ?: "data folder operation failed")
    }
  }

  private data class Node(val uri: Uri, val dir: Boolean, val len: Long)

  private fun stat(context: Context, tree: String, rel: String): String {
    val node = resolve(context, tree, rel, createParents = false)
    if (node == null) return ok(JSONObject().put("kind", "missing").put("len", 0))
    val kind = if (node.dir) "dir" else "file"
    return ok(JSONObject().put("kind", kind).put("len", node.len))
  }

  private fun mkdir(context: Context, tree: String, rel: String): String {
    if (rel.isEmpty()) return err("already_exists", "data folder already exists")
    val parentRel = parentRel(rel) ?: return err("invalid_input", "invalid path")
    val name = leaf(rel) ?: return err("invalid_input", "invalid path")
    val parent = resolve(context, tree, parentRel, createParents = false)
      ?: return err("not_found", "parent is missing")
    if (!parent.dir) return err("not_a_directory", "parent is a file")
    if (findChild(context, tree, parent, name, rel) != null) {
      return err("already_exists", "already exists")
    }
    val created = createDocument(context, parent.uri, MIME_DIR, name)
    if (created == null) {
      dropChildIndex(parent)
      val found = findChild(context, tree, parent, name, rel)
      if (found == null || !found.dir) return err("other", "cannot create directory")
      remember(rel, found)
      return ok()
    }
    remember(rel, Node(created, true, 0))
    return ok()
  }

  private fun remove(
    context: Context,
    tree: String,
    rel: String,
    recursive: Boolean,
    directory: Boolean,
  ): String {
    val node = resolve(context, tree, rel, createParents = false)
      ?: return err("not_found", "no such file or directory")
    if (directory && !node.dir) return err("not_a_directory", "not a directory")
    if (!directory && node.dir) return err("is_a_directory", "is a directory")
    if (node.dir && !recursive && listChildren(context, tree, node).isNotEmpty()) {
      return err("not_empty", "directory not empty")
    }
    if (!deleteTree(context, tree, node, recursive)) return err("other", "cannot delete")
    forget(rel)
    dropChildIndex(node)
    val parentRel = parentRel(rel)
    if (parentRel != null) {
      resolve(context, tree, parentRel, createParents = false)?.let { dropChildIndex(it) }
    }
    return ok()
  }

  private fun deleteTree(context: Context, tree: String, node: Node, recursive: Boolean): Boolean {
    if (recursive && node.dir) {
      for (child in listChildren(context, tree, node)) {
        if (!deleteTree(context, tree, child.node, true)) return false
      }
    }
    return deleteDocument(context, node.uri)
  }

  private fun rename(context: Context, tree: String, fromRel: String, toRel: String): String {
    val from = resolve(context, tree, fromRel, createParents = false)
      ?: return err("not_found", "no such file or directory")
    val toParentRel = parentRel(toRel) ?: return err("invalid_input", "invalid path")
    val toName = leaf(toRel) ?: return err("invalid_input", "invalid path")
    val toParent = resolve(context, tree, toParentRel, createParents = false)
      ?: return err("not_found", "destination parent is missing")
    if (!toParent.dir) return err("not_a_directory", "destination parent is a file")
    val fromParentRel = parentRel(fromRel) ?: return err("invalid_input", "invalid path")
    val sameParent = fromParentRel == toParentRel
    if (!sameParent) {
      val moved = try {
        DocumentsContract.moveDocument(
          context.contentResolver,
          from.uri,
          parentUri(context, tree, fromParentRel),
          toParent.uri,
        )
      } catch (error: Throwable) {
        Log.w(TAG, "moveDocument: ${error.message}")
        null
      } ?: return err("other", "cannot move")
      val renamed = if (leaf(fromRel) == toName) {
        moved
      } else {
        renameOrFind(context, tree, toParent, toRel, moved, toName) ?: return err("other", "cannot rename")
      }
      forget(fromRel)
      dropChildIndex(toParent)
      resolve(context, tree, fromParentRel, createParents = false)?.let { dropChildIndex(it) }
      remember(toRel, Node(renamed, from.dir, from.len))
      return ok()
    }
    // DocumentsContract will not rename onto a name that already exists.
    // Settings saves write a temp file and rename it to settings.toml, so
    // move the current document aside first, then put it back if the rename fails.
    val existing = if (fromRel == toRel) {
      null
    } else {
      findChild(context, tree, toParent, toName, toRel)
    }
    var backupRel: String? = null
    var backupUri: Uri? = null
    if (existing != null && !sameDocument(existing.uri, from.uri)) {
      if (existing.dir) return err("is_a_directory", "destination is a directory")
      val backupName = "$toName.${System.nanoTime()}.replacing"
      val asideRel = if (toParentRel.isEmpty()) backupName else "$toParentRel/$backupName"
      val aside = renameOrFind(context, tree, toParent, asideRel, existing.uri, backupName)
        ?: return err("other", "cannot replace")
      forget(toRel)
      dropChildIndex(toParent)
      backupRel = asideRel
      backupUri = aside
    }
    val renamed = renameOrFind(context, tree, toParent, toRel, from.uri, toName)
    if (renamed == null) {
      val asideRel = backupRel
      val asideUri = backupUri
      if (asideRel != null && asideUri != null) {
        renameOrFind(context, tree, toParent, toRel, asideUri, toName)
        forget(asideRel)
        dropChildIndex(toParent)
      }
      return err("other", "cannot rename")
    }
    if (backupUri != null) {
      if (!deleteDocument(context, backupUri)) {
        Log.w(TAG, "replaced $toRel but could not delete the previous document")
      }
      backupRel?.let { forget(it) }
    }
    forget(fromRel)
    dropChildIndex(toParent)
    remember(toRel, Node(renamed, from.dir, from.len))
    return ok()
  }

  /**
   * Some providers rename the document and still return null. Success is this
   * document under the new name. A different document that already had the
   * name is left untouched.
   */
  private fun renameOrFind(
    context: Context,
    tree: String,
    parent: Node,
    toRel: String,
    uri: Uri,
    name: String,
  ): Uri? {
    val renamed = try {
      DocumentsContract.renameDocument(context.contentResolver, uri, name)
    } catch (error: Throwable) {
      Log.w(TAG, "renameDocument: ${error.message}")
      null
    }
    if (renamed != null) return renamed
    val current = displayName(context, uri)
    if (current == name) return uri
    // The provider kept this document's old name, or its name could not be
    // read. A listing hit is this rename only when it is the same document.
    // Another document that already uses `name` stays untouched.
    if (current != null) return null
    dropChildIndex(parent)
    val found = findChild(context, tree, parent, name, toRel) ?: return null
    return if (sameDocument(found.uri, uri)) found.uri else null
  }

  private fun displayName(context: Context, uri: Uri): String? {
    return try {
      context.contentResolver.query(
        uri,
        arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
        null,
        null,
        null,
      )?.use { cursor ->
        if (!cursor.moveToFirst()) return null
        val col = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        if (col < 0) null else cursor.getString(col)
      }
    } catch (_: Throwable) {
      null
    }
  }

  private fun list(context: Context, tree: String, rel: String): String {
    val node = resolve(context, tree, rel, createParents = false)
      ?: return err("not_found", "no such directory")
    if (!node.dir) return err("not_a_directory", "not a directory")
    val listed = listChildrenResult(context, tree, node)
    if (!listed.ok) return err("other", "cannot list directory")
    val indexed = indexByDisplayName(listed.children)
      ?: return err("already_exists", "duplicate name")
    val entries = JSONArray()
    for ((name, child) in indexed) {
      val entry = JSONObject()
        .put("name", name)
        .put("kind", if (child.dir) "dir" else "file")
      // Negative length means the provider did not report a size.
      if (child.len >= 0) entry.put("len", child.len)
      entries.put(entry)
    }
    return ok(JSONObject().put("entries", entries))
  }

  private fun open(context: Context, tree: String, json: JSONObject): String {
    val rel = json.optString("rel")
    val read = json.optBoolean("read")
    val write = json.optBoolean("write")
    val truncate = json.optBoolean("truncate")
    val create = json.optBoolean("create")
    val createNew = json.optBoolean("create_new")
    val parentRel = parentRel(rel) ?: return err("invalid_input", "invalid path")
    val name = leaf(rel) ?: return err("invalid_input", "invalid path")
    val parent = resolve(context, tree, parentRel, createParents = false)
      ?: return err("not_found", "parent is missing")
    if (!parent.dir) return err("not_a_directory", "parent is a file")
    var existing = findChild(context, tree, parent, name, rel)
    if (createNew && existing != null) return err("already_exists", "already exists")
    var createdUri: Uri? = null
    if (existing == null && (create || createNew)) {
      createdUri = createDocument(context, parent.uri, MIME_FILE, name)
      if (createdUri == null) {
        dropChildIndex(parent)
        existing = findChild(context, tree, parent, name, rel)
        if (existing == null) return err("other", "cannot create file")
      }
    }
    val node = existing
      ?: createdUri?.let { Node(it, false, 0) }
      ?: return err("not_found", "no such file")
    if (node.dir) return err("is_a_directory", "is a directory")
    if (createdUri != null) remember(rel, node)
    val mode = when {
      truncate && read -> "rwt"
      truncate || (!read && write) -> "wt"
      read && write -> "rw"
      write -> "w"
      else -> "r"
    }
    return openDescriptor(context, tree, parent, parentRel, node, name, rel, mode, truncate)
  }

  private fun openDescriptor(
    context: Context,
    tree: String,
    parent: Node,
    parentRel: String,
    node: Node,
    name: String,
    rel: String,
    mode: String,
    truncate: Boolean,
  ): String {
    openFd(context, node.uri, mode)?.let { return it }
    if (!truncate) return err("other", "cannot open file")
    // A read-write fd of the old document still has the previous bytes.
    // Rust then refuses the truncating open, so try the truncating modes first.
    if (mode != "w") openFd(context, node.uri, "w")?.let { return it }
    if (mode != "rwt") openFd(context, node.uri, "rwt")?.let { return it }
    return replaceThenOpen(context, tree, parent, parentRel, node, name, rel)
  }

  /**
   * Move the current document aside, create and open a replacement under the
   * same name, then delete the aside copy. A failed replacement puts the
   * aside copy back, so the previous bytes are not dropped first.
   */
  private fun replaceThenOpen(
    context: Context,
    tree: String,
    parent: Node,
    parentRel: String,
    node: Node,
    name: String,
    rel: String,
  ): String {
    val backupName = "$name.${System.nanoTime()}.replacing"
    val backupRel = if (parentRel.isEmpty()) backupName else "$parentRel/$backupName"
    val aside = renameOrFind(context, tree, parent, backupRel, node.uri, backupName)
      ?: return err("other", "cannot open file")
    forget(rel)
    dropChildIndex(parent)
    val created = createDocument(context, parent.uri, MIME_FILE, name)
    if (created == null) {
      restoreReplaced(context, tree, parent, rel, backupRel, aside, name)
      return err("other", "cannot open file")
    }
    val opened = openFd(context, created, "rw")
    if (opened == null) {
      deleteDocument(context, created)
      restoreReplaced(context, tree, parent, rel, backupRel, aside, name)
      return err("other", "cannot open file")
    }
    if (!deleteDocument(context, aside)) {
      Log.w(TAG, "replaced $rel but could not delete the previous document")
    }
    forget(backupRel)
    dropChildIndex(parent)
    remember(rel, Node(created, false, -1L))
    return opened
  }

  private fun restoreReplaced(
    context: Context,
    tree: String,
    parent: Node,
    rel: String,
    backupRel: String,
    aside: Uri,
    name: String,
  ) {
    val restored = renameOrFind(context, tree, parent, rel, aside, name)
    if (restored != null) remember(rel, Node(restored, false, -1L))
    forget(backupRel)
    dropChildIndex(parent)
  }

  private fun openFd(context: Context, uri: Uri, mode: String): String? {
    val pfd = try {
      context.contentResolver.openFileDescriptor(uri, mode)
    } catch (error: Throwable) {
      Log.w(TAG, "openFileDescriptor($mode): ${error.message}")
      null
    } ?: return null
    val fd = pfd.detachFd()
    if (fd < 0) return null
    return ok(JSONObject().put("fd", fd))
  }

  private fun resolve(context: Context, tree: String, rel: String, createParents: Boolean): Node? {
    var current = rootNode(context, tree) ?: return null
    if (rel.isEmpty()) return current
    val parts = rel.split('/').filter { it.isNotEmpty() }
    var walked = ""
    for ((index, name) in parts.withIndex()) {
      if (name == "." || name == "..") return null
      walked = if (walked.isEmpty()) name else "$walked/$name"
      val child = findChild(context, tree, current, name, walked)
      if (child != null) {
        current = child
        continue
      }
      if (!createParents || index == parts.lastIndex) return null
      val created = createDocument(context, current.uri, MIME_DIR, name) ?: return null
      current = Node(created, true, 0)
      remember(walked, current)
    }
    return current
  }

  private fun rootNode(context: Context, tree: String): Node? {
    val parsed = Uri.parse(tree)
    val treeId = try {
      DocumentsContract.getTreeDocumentId(parsed)
    } catch (_: Throwable) {
      return null
    }
    val uri = DocumentsContract.buildDocumentUriUsingTree(parsed, treeId)
    val base = Node(uri, true, 0)
    if (treeId != "primary:Documents" && treeId != "home:Documents") return base
    // The remember key is not a vault path. A file named Upriv inside the
    // data folder must not reuse this cache entry.
    val existing = findChild(context, tree, base, "Upriv", "\u0000Upriv")
    if (existing != null) return if (existing.dir) existing else null
    val created = createDocument(context, base.uri, MIME_DIR, "Upriv") ?: return null
    return Node(created, true, 0)
  }

  private fun parentUri(context: Context, tree: String, parentRel: String): Uri {
    return resolve(context, tree, parentRel, createParents = false)?.uri
      ?: rootNode(context, tree)?.uri
      ?: Uri.parse(tree)
  }

  private data class Listed(val name: String, val node: Node)

  private fun remember(rel: String, node: Node) {
    if (rel.isNotEmpty()) remembered[rel] = node
  }

  private fun forget(rel: String) {
    remembered.remove(rel)
    val prefix = "$rel/"
    for (key in remembered.keys) {
      if (key.startsWith(prefix)) remembered.remove(key)
    }
  }

  private fun dropChildIndex(parent: Node) {
    childIndex.remove(parent.uri.toString())
  }

  private fun findChild(
    context: Context,
    tree: String,
    parent: Node,
    name: String,
    childRel: String,
  ): Node? {
    remembered[childRel]?.let { return it }
    val parentId = try {
      DocumentsContract.getDocumentId(parent.uri)
    } catch (_: Throwable) {
      return null
    }
    val uri = DocumentsContract.buildDocumentUriUsingTree(Uri.parse(tree), "$parentId/$name")
    queryNode(context, uri, name)?.let { node ->
      remember(childRel, node)
      return node
    }
    val listed = childFromListing(context, tree, parent, name) ?: return null
    remember(childRel, listed)
    return listed
  }

  /** Cached children of `parent`. A failed listing is not cached. */
  private fun childFromListing(
    context: Context,
    tree: String,
    parent: Node,
    name: String,
  ): Node? {
    val key = parent.uri.toString()
    val cached = childIndex[key]
    if (cached != null) return cached[name]
    val listed = listChildrenResult(context, tree, parent)
    if (!listed.ok) return null
    val map = indexByDisplayName(listed.children) ?: return null
    val stored = childIndex.putIfAbsent(key, map) ?: map
    return stored[name]
  }

  /**
   * One node per display name. The same document listed twice is one entry.
   * Two document ids with one name are a miss: caching either one hides the other.
   */
  private fun indexByDisplayName(children: List<Listed>): LinkedHashMap<String, Node>? {
    val map = LinkedHashMap<String, Node>(children.size)
    for (child in children) {
      val previous = map[child.name]
      if (previous == null) {
        map[child.name] = child.node
        continue
      }
      if (sameDocument(previous.uri, child.node.uri)) continue
      return null
    }
    return map
  }

  private fun sameDocument(left: Uri, right: Uri): Boolean {
    val leftId = documentIdOrNull(left) ?: return false
    val rightId = documentIdOrNull(right) ?: return false
    return leftId == rightId
  }

  private fun documentIdOrNull(uri: Uri): String? {
    return try {
      DocumentsContract.getDocumentId(uri)
    } catch (_: Throwable) {
      null
    }
  }

  private fun listChildren(context: Context, tree: String, parent: Node): List<Listed> {
    return listChildrenResult(context, tree, parent).children
  }

  private data class ChildListing(val ok: Boolean, val children: List<Listed>)

  /** `ok` is false when the provider query itself failed. */
  private fun listChildrenResult(
    context: Context,
    tree: String,
    parent: Node,
  ): ChildListing {
    val parentId = try {
      DocumentsContract.getDocumentId(parent.uri)
    } catch (_: Throwable) {
      return ChildListing(ok = false, children = emptyList())
    }
    val parsed = Uri.parse(tree)
    val children = DocumentsContract.buildChildDocumentsUriUsingTree(parsed, parentId)
    val out = ArrayList<Listed>()
    try {
      context.contentResolver.query(
        children,
        arrayOf(
          DocumentsContract.Document.COLUMN_DOCUMENT_ID,
          DocumentsContract.Document.COLUMN_DISPLAY_NAME,
          DocumentsContract.Document.COLUMN_MIME_TYPE,
          DocumentsContract.Document.COLUMN_SIZE,
        ),
        null,
        null,
        null,
      )?.use { cursor ->
        val idCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
        val nameCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        val mimeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
        val sizeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
        while (cursor.moveToNext()) {
          if (nameCol < 0 || idCol < 0) continue
          val name = cursor.getString(nameCol) ?: continue
          val id = cursor.getString(idCol) ?: continue
          val mime = if (mimeCol >= 0) cursor.getString(mimeCol) else null
          val dir = mime == MIME_DIR
          val len = reportedLen(dir, sizeCol, cursor)
          val uri = DocumentsContract.buildDocumentUriUsingTree(parsed, id)
          out.add(Listed(name, Node(uri, dir, len)))
        }
      } ?: return ChildListing(ok = false, children = emptyList())
    } catch (error: Throwable) {
      Log.w(TAG, "list children: ${error.message}")
      return ChildListing(ok = false, children = emptyList())
    }
    return ChildListing(ok = true, children = out)
  }

  /** `-1` when the provider did not report a size. `0` is an empty file. */
  private fun reportedLen(dir: Boolean, sizeCol: Int, cursor: android.database.Cursor): Long {
    if (dir || sizeCol < 0 || cursor.isNull(sizeCol)) return -1L
    val size = cursor.getLong(sizeCol)
    return if (size < 0) -1L else size
  }

  private fun createDocument(context: Context, parent: Uri, mime: String, name: String): Uri? {
    val created = try {
      DocumentsContract.createDocument(context.contentResolver, parent, mime, name)
    } catch (error: Throwable) {
      Log.w(TAG, "createDocument failed: ${error.javaClass.simpleName}")
      null
    }
    if (created != null) return created
    // Some providers create a leading-dot name and still return null, and
    // directory listings skip that name. The document id is parent + "/" + name.
    val tree = treeUri.get()
    val parentId = try {
      DocumentsContract.getDocumentId(parent)
    } catch (_: Throwable) {
      return null
    }
    val guessed = DocumentsContract.buildDocumentUriUsingTree(Uri.parse(tree), "$parentId/$name")
    return if (queryNode(context, guessed, name) != null) guessed else null
  }

  private fun deleteDocument(context: Context, uri: Uri): Boolean {
    return try {
      DocumentsContract.deleteDocument(context.contentResolver, uri)
    } catch (error: Throwable) {
      Log.w(TAG, "deleteDocument: ${error.message}")
      false
    }
  }

  /**
   * One query for existence, kind, and length. A missing document is not a
   * directory listing. When `expectedName` is set, a row for a different
   * document (some providers answer with the tree root) is a miss.
   */
  private fun queryNode(context: Context, uri: Uri, expectedName: String? = null): Node? {
    return try {
      context.contentResolver.query(
        uri,
        arrayOf(
          DocumentsContract.Document.COLUMN_DOCUMENT_ID,
          DocumentsContract.Document.COLUMN_DISPLAY_NAME,
          DocumentsContract.Document.COLUMN_MIME_TYPE,
          DocumentsContract.Document.COLUMN_SIZE,
        ),
        null,
        null,
        null,
      )?.use { cursor ->
        if (!cursor.moveToFirst()) return null
        val nameCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        val foundName =
          if (nameCol >= 0 && !cursor.isNull(nameCol)) cursor.getString(nameCol) else null
        if (expectedName != null && foundName != expectedName) {
          // A different display name is a miss. A missing name is this document
          // only when the row's id is the id we queried. Providers answer some
          // child queries with the tree root, which has another id.
          val idCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
          val foundId = if (idCol >= 0 && !cursor.isNull(idCol)) cursor.getString(idCol) else null
          val sameId = foundName == null && foundId != null && foundId == documentIdOrNull(uri)
          if (!sameId) return null
        }
        val mimeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
        val sizeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
        val mime = if (mimeCol >= 0) cursor.getString(mimeCol) else null
        val dir = mime == MIME_DIR
        val len = reportedLen(dir, sizeCol, cursor)
        Node(uri, dir, len)
      }
    } catch (_: Throwable) {
      null
    }
  }

  private fun parentRel(rel: String): String? {
    if (rel.isEmpty() || rel.startsWith("/") || rel.contains("\\") || rel.contains("\u0000")) {
      return null
    }
    val slash = rel.lastIndexOf('/')
    if (slash < 0) return ""
    return rel.substring(0, slash)
  }

  private fun leaf(rel: String): String? {
    if (rel.isEmpty()) return null
    val name = rel.substringAfterLast('/')
    if (name.isEmpty() || name == "." || name == "..") return null
    return name
  }

  private fun ok(body: JSONObject = JSONObject()): String {
    body.put("ok", true)
    return body.toString()
  }

  private fun err(code: String, message: String): String {
    return JSONObject().put("ok", false).put("err", code).put("message", message).toString()
  }
}
