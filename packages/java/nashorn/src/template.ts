import type { NashornTemplateOptions } from './types.js';

export function getNashornTemplate(options?: NashornTemplateOptions): string {
  const globalName = options?.globalName || 'Java';
  const includePolyfills = options?.includePolyfills !== false;
  const onUnmapped = options?.onUnmapped || 'passthrough';
  const customHeader = options?.customHeader || '';

  const mappings: Record<string, string> = { ...(options?.mappings || {}) };
  const fieldMappings: Record<string, Record<string, string>> = {
    ...(options?.fieldMappings || {}),
  };
  const methodMappings: Record<string, Record<string, string>> = {
    ...(options?.methodMappings || {}),
  };

  if (options?.pool && typeof options.pool.getAllDetected === 'function') {
    for (const detected of options.pool.getAllDetected()) {
      mappings[detected.canonicalName] = detected.realClassName;
      if (detected.simpleName) {
        mappings[detected.simpleName] = detected.realClassName;
      }
      if (detected.fields) {
        fieldMappings[detected.canonicalName] = {
          ...fieldMappings[detected.canonicalName],
          ...detected.fields,
        };
        fieldMappings[detected.realClassName] = {
          ...fieldMappings[detected.realClassName],
          ...detected.fields,
        };
      }
      if (detected.methods) {
        methodMappings[detected.canonicalName] = {
          ...methodMappings[detected.canonicalName],
          ...detected.methods,
        };
        methodMappings[detected.realClassName] = {
          ...methodMappings[detected.realClassName],
          ...detected.methods,
        };
      }
    }
  }

  const lines: string[] = [];

  // 1. Custom header
  if (customHeader) {
    lines.push(customHeader);
  }

  // 2. ES5 Polyfills for Nashorn
  if (includePolyfills) {
    lines.push(`
// --- Nashorn ES5 Polyfills ---
(function() {
  if (typeof Object.assign !== 'function') {
    Object.assign = function(target) {
      if (target === undefined || target === null) throw new TypeError('Cannot convert undefined or null to object');
      var to = Object(target);
      for (var index = 1; index < arguments.length; index++) {
        var nextSource = arguments[index];
        if (nextSource !== undefined && nextSource !== null) {
          for (var nextKey in nextSource) {
            if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
              to[nextKey] = nextSource[nextKey];
            }
          }
        }
      }
      return to;
    };
  }
  if (typeof Object.entries !== 'function') {
    Object.entries = function(obj) {
      var ownProps = Object.keys(obj), i = ownProps.length, resArray = new Array(i);
      while (i--) resArray[i] = [ownProps[i], obj[ownProps[i]]];
      return resArray;
    };
  }
  if (typeof Object.values !== 'function') {
    Object.values = function(obj) {
      var ownProps = Object.keys(obj), i = ownProps.length, resArray = new Array(i);
      while (i--) resArray[i] = obj[ownProps[i]];
      return resArray;
    };
  }
  if (typeof Array.prototype.find !== 'function') {
    Array.prototype.find = function(predicate) {
      if (this === null) throw new TypeError('Array.prototype.find called on null or undefined');
      if (typeof predicate !== 'function') throw new TypeError('predicate must be a function');
      var list = Object(this);
      var length = list.length >>> 0;
      var thisArg = arguments[1];
      for (var i = 0; i < length; i++) {
        var value = list[i];
        if (predicate.call(thisArg, value, i, list)) return value;
      }
      return undefined;
    };
  }
  if (typeof Array.prototype.includes !== 'function') {
    Array.prototype.includes = function(searchElement, fromIndex) {
      if (this === null) throw new TypeError('"this" is null or not defined');
      var o = Object(this);
      var len = o.length >>> 0;
      if (len === 0) return false;
      var n = fromIndex | 0;
      var k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);
      while (k < len) {
        if (o[k] === searchElement) return true;
        k++;
      }
      return false;
    };
  }
  if (typeof String.prototype.includes !== 'function') {
    String.prototype.includes = function(search, start) {
      if (typeof start !== 'number') start = 0;
      if (start + search.length > this.length) return false;
      return this.indexOf(search, start) !== -1;
    };
  }
})();
`);
  }

  // 3. Global Java & Java.type shim
  const mappingsJson = JSON.stringify(mappings);
  const fieldsJson = JSON.stringify(fieldMappings);
  const methodsJson = JSON.stringify(methodMappings);

  lines.push(`
// --- Nashorn Java Mapping & Hook Shim ---
(function(global) {
  if (typeof global.${globalName} === 'undefined') {
    global.${globalName} = {};
  }
  var J = global.${globalName};
  var _origType = typeof J.type === 'function' ? J.type : (typeof Java !== 'undefined' && typeof Java.type === 'function' ? Java.type : null);

  var _classMap = ${mappingsJson};
  var _fieldMap = ${fieldsJson};
  var _methodMap = ${methodsJson};

  J.type = function(canonicalName) {
    if (!canonicalName) return null;
    var mappedName = _classMap[canonicalName] || canonicalName;
    if (_origType) {
      try {
        return _origType(mappedName);
      } catch (err) {
        if (mappedName !== canonicalName) {
          try { return _origType(canonicalName); } catch (e2) {}
        }
        ${onUnmapped === 'throw' ? 'throw err;' : ''}
        ${onUnmapped === 'warn' ? 'if (typeof print === "function") print("[Nashorn-Shim Warning] Class not found: " + canonicalName + " (" + mappedName + ")");' : ''}
        return null;
      }
    }
    return null;
  };

  J.code = function(sourceOrFn, name) {
    if (typeof sourceOrFn === 'function') {
      var body = undefined;
      return {
        $className: 'jdk.nashorn.internal.runtime.ScriptFunction',
        __isScriptFunction: true,
        fn: sourceOrFn,
        name: name || sourceOrFn.name || '<anonymous>',
        getString: function() {
          if (body === undefined) body = sourceOrFn.toString();
          return body;
        },
        toString: function() {
          if (body === undefined) body = sourceOrFn.toString();
          return body;
        },
        valueOf: function() {
          if (body === undefined) body = sourceOrFn.toString();
          return body;
        }
      };
    }
    var str = String(sourceOrFn || '');
    return {
      $className: 'jdk.nashorn.internal.runtime.Source',
      __isJavaCode: true,
      code: str,
      name: name || '<eval>',
      getString: function() { return str; },
      toString: function() { return str; },
      valueOf: function() { return str; }
    };
  };

  J.getObfClass = function(canonicalName) {
    return _classMap[canonicalName] || canonicalName;
  };

  J.getObfField = function(classKey, fieldName) {
    if (_fieldMap[classKey] && _fieldMap[classKey][fieldName]) {
      return _fieldMap[classKey][fieldName];
    }
    return fieldName;
  };

  J.getObfMethod = function(classKey, methodName) {
    if (_methodMap[classKey] && _methodMap[classKey][methodName]) {
      return _methodMap[classKey][methodName];
    }
    return methodName;
  };

  J.resolveMember = function(targetObj, memberName) {
    if (!targetObj || !memberName) return memberName;
    if (typeof targetObj[memberName] !== 'undefined') return memberName;
    var clsName = targetObj.getClass ? targetObj.getClass().getName() : (targetObj.$className || '');
    if (clsName) {
      var f = J.getObfField(clsName, memberName);
      if (typeof targetObj[f] !== 'undefined') return f;
      var m = J.getObfMethod(clsName, memberName);
      if (typeof targetObj[m] !== 'undefined') return m;
    }
    return memberName;
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
`);

  return lines.join('\n');
}
