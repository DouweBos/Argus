package dev.houwert.argus.app.storage

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dev.houwert.argus.kit.storage.KeyValueStore
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

private val Context.argusPreferences by preferencesDataStore("argus")

/**
 * DataStore behind the synchronous [KeyValueStore] the shared code reads: the
 * whole store is read once at launch and kept in memory, and writes go through.
 */
class DataStoreKeyValueStore(context: Context, private val scope: CoroutineScope) : KeyValueStore {
  private val store = context.argusPreferences
  private val cache = ConcurrentHashMap<String, String>()

  init {
    // Small, local, and needed before the first frame decides what to show.
    runBlocking {
      store.data.first().asMap().forEach { (key, value) -> if (value is String) cache[key.name] = value }
    }
  }

  override fun string(key: String): String? = cache[key]

  override fun set(key: String, value: String?) {
    if (value == null) cache.remove(key) else cache[key] = value
    scope.launch {
      store.edit { prefs ->
        val k = stringPreferencesKey(key)
        if (value == null) prefs.remove(k) else prefs[k] = value
      }
    }
  }
}
