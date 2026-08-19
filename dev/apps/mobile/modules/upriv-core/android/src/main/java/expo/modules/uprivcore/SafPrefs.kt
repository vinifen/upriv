package expo.modules.uprivcore

import android.content.Context

/**
 * Persist the currently active SAF tree URI (custom vault-root chosen by the
 * user through `ACTION_OPEN_DOCUMENT_TREE`).
 *
 * Rust `.upriv-root` alias file lives under `filesDir/upriv/` and only accepts
 * absolute `std::fs` paths — it cannot hold a `content://` URI. This preference
 * plays the analogous role for the SAF flow on Android, kept **outside**
 * the vault-root itself so the app can still find the root at launch.
 *
 * Content:
 * - `active_uri`: current tree URI (empty = SAF mode inactive)
 *
 * Stored via Android SharedPreferences (per-app private XML in `data/data/…/shared_prefs/`).
 * Not encrypted — the URI is just a pointer, never a secret.
 */
internal object SafPrefs {
  private const val FILE_NAME = "upriv_saf_prefs"
  private const val KEY_ACTIVE_URI = "active_uri"

  fun getActiveUri(context: Context): String? {
    val prefs = context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)
    val value = prefs.getString(KEY_ACTIVE_URI, null)
    return value?.takeIf { it.isNotBlank() }
  }

  /** `null` or empty string clears the pref (switch back to Rust default_root). */
  fun setActiveUri(context: Context, uri: String?) {
    val prefs = context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)
    // commit() — Apply/setup then immediately save; apply() can race a same-tick read.
    val ok =
      prefs.edit().run {
        if (uri.isNullOrBlank()) remove(KEY_ACTIVE_URI) else putString(KEY_ACTIVE_URI, uri)
        commit()
      }
    if (!ok) {
      throw IllegalStateException("UprivSaf: failed to persist active SAF URI")
    }
  }
}
