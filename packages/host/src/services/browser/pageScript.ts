/**
 * Runs inside the page via `Runtime.evaluate`: the element at (nx, ny), 0–1
 * across the viewport. Plain JS in a string — the host has no DOM types, and
 * a bundler's helpers would break a stringified function.
 */
export const DESCRIBE_AT = String.raw`(function (nx, ny, full) {
  var x = nx * innerWidth, y = ny * innerHeight;
  var el = document.elementFromPoint(x, y);
  while (el && el.shadowRoot) {
    var inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  if (!el) return null;
  var tag = el.tagName.toLowerCase();
  var classes = Array.from(el.classList).filter(function (c) { return /^[\w-]+$/.test(c); });
  var label = tag + (el.id ? "#" + el.id : "") +
    classes.slice(0, 2).map(function (c) { return "." + c; }).join("");
  var r = el.getBoundingClientRect();
  var hit = {
    label: label,
    bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
    viewport: { width: innerWidth, height: innerHeight }
  };
  if (!full) return hit;

  function unique(sel) {
    try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
  }
  function step(node) {
    if (node.id && unique("#" + CSS.escape(node.id))) return "#" + CSS.escape(node.id);
    var part = node.tagName.toLowerCase();
    Array.from(node.classList).filter(function (c) { return /^[\w-]+$/.test(c); }).slice(0, 3)
      .forEach(function (c) { part += "." + CSS.escape(c); });
    var parent = node.parentElement;
    if (parent) {
      var same = Array.from(parent.children).filter(function (c) { return c.tagName === node.tagName; });
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
    }
    return part;
  }
  var parts = [];
  for (var node = el; node && node !== document.documentElement && parts.length < 8; node = node.parentElement) {
    parts.unshift(step(node));
    if (parts[0].charAt(0) === "#" || unique(parts.join(" > "))) break;
  }

  function cap(s, n) { return s.length > n ? s.slice(0, n) + "…" : s; }
  var attributes = {};
  Array.from(el.attributes).forEach(function (a) {
    if (/^(id|class|role|name|type|href|src|alt|title|placeholder|for|value)$/.test(a.name) ||
        a.name.indexOf("aria-") === 0 || a.name.indexOf("data-") === 0) {
      attributes[a.name] = cap(a.value, 200);
    }
  });
  var computed = getComputedStyle(el);
  var styles = {};
  ["display", "position", "color", "background-color", "font-family", "font-size", "font-weight",
   "line-height", "padding", "margin", "border", "border-radius", "gap", "opacity", "box-shadow"]
    .forEach(function (key) {
      var value = computed.getPropertyValue(key);
      if (value && !/^(none|normal|auto|0px|1|rgba\(0, 0, 0, 0\)|0px none .*)$/.test(value)) {
        styles[key] = cap(value, 120);
      }
    });
  var text = (el.innerText || "").replace(/\s+/g, " ").trim();

  // Raw source hints; the host parses them and maps stacks through the dev server's source maps.
  var hints = {};
  var fiberKey = Object.keys(el).find(function (k) { return k.indexOf("__reactFiber$") === 0; });
  var hostFiber = fiberKey ? el[fiberKey] : null;
  for (var fiber = hostFiber; fiber; fiber = fiber.return) {
    if (typeof fiber.type === "function") {
      var own = (hostFiber && hostFiber._debugSource) || fiber._debugSource;
      var debugStack = (hostFiber && hostFiber._debugStack) || fiber._debugStack;
      hints.react = {
        component: fiber.type.displayName || fiber.type.name || undefined,
        fileName: own ? own.fileName : undefined,
        lineNumber: own ? own.lineNumber : undefined,
        columnNumber: own ? own.columnNumber : undefined,
        stack: debugStack && typeof debugStack.stack === "string" ? cap(debugStack.stack, 4000) : undefined
      };
      break;
    }
  }
  for (var vnode = el; vnode && !hints.vue; vnode = vnode.parentElement) {
    var instance = vnode.__vueParentComponent || (vnode.__vue__ && vnode.__vue__.$);
    if (instance && instance.type) {
      hints.vue = { component: instance.type.name || instance.type.__name || undefined, file: instance.type.__file };
    }
  }
  for (var snode = el; snode && !hints.svelte; snode = snode.parentElement) {
    var loc = snode.__svelte_meta && snode.__svelte_meta.loc;
    if (loc && loc.file) {
      hints.svelte = { file: loc.file, line: loc.line, column: loc.column, zeroBased: "char" in loc };
    }
  }
  for (var anode = el; anode && anode.getAttribute && !hints.attributes; anode = anode.parentElement) {
    var found = {};
    Array.from(anode.attributes).forEach(function (a) {
      if (/^data-(v-inspector|inspector-|source|locator)/.test(a.name)) found[a.name] = cap(a.value, 500);
    });
    if (Object.keys(found).length) hints.attributes = found;
  }

  return Object.assign(hit, {
    selector: parts.join(" > "),
    tagName: tag,
    text: text ? cap(text, 200) : undefined,
    attributes: attributes,
    styles: styles,
    html: cap(el.outerHTML, 1500),
    sourceHints: hints,
    url: location.href,
    scroll: { x: scrollX, y: scrollY }
  });
})`;
