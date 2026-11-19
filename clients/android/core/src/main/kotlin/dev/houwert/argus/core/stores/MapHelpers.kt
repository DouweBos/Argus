package dev.houwert.argus.core.stores

/** Remove matching items from one key's list, dropping the key once it's empty. */
internal fun <K, V> Map<K, List<V>>.removingItem(key: K, predicate: (V) -> Boolean): Map<K, List<V>> {
  val list = this[key] ?: return this
  val next = list.filterNot(predicate)
  return if (next.isEmpty()) this - key else this + (key to next)
}

/** Append to one key's list. */
internal fun <K, V> Map<K, List<V>>.appendingItem(key: K, value: V): Map<K, List<V>> = this + (key to (this[key].orEmpty() + value))

/** Set or remove a key: null removes it. */
internal fun <K, V : Any> Map<K, V>.with(key: K, value: V?): Map<K, V> = if (value == null) this - key else this + (key to value)
