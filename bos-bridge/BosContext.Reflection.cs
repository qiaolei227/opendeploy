using System;
using System.Collections.Generic;
using System.Reflection;

namespace OpenDeploy.BosBridge
{
    // ── Generic reflection helpers (Plan 5.12.3b — Task 2.2 follow-up) ─────
    //
    // Type-/op-agnostic reflection utilities used by every BusinessRules op:
    // - ReferenceEqualityComparer (net48 has no built-in System.Collections.Generic.ReferenceEqualityComparer)
    // - ResolveType + _typeCache (BOS Core type lookup by full name, process-lifetime cached)
    // - SetProp (graceful reflection setter with type coercion)
    // - ConvertValue (scalar / nullable / wrapper coercion)
    //
    // Split out of BosContext.BusinessRules.cs after Task 2.2 to keep the
    // business-rule file focused on BusinessInfo-shaped semantics; this file
    // is the home for *anything* a future op (Tasks 2.3-2.4 + later subsystems)
    // can reuse without naming the BOS domain.

    internal sealed partial class BosContext
    {
        /// <summary>
        /// Reference-equality dedup for <see cref="HashSet{T}"/> over BOS
        /// objects. net48 lacks <c>System.Collections.Generic.ReferenceEqualityComparer.Instance</c>
        /// (added in .NET 5); drop this class once the bridge moves off net48.
        /// </summary>
        private sealed class ReferenceEqualityComparer : IEqualityComparer<object>
        {
            public static readonly ReferenceEqualityComparer Instance = new ReferenceEqualityComparer();
            public new bool Equals(object? x, object? y) => ReferenceEquals(x, y);
            public int GetHashCode(object obj) => System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(obj);
        }

        // Process-lifetime cache; never invalidated. Safe because the BOS dll
        // set is loaded once at bridge startup (DllResolver) and the AppDomain
        // stays alive for the bridge's whole life — type identities don't move.
        private static readonly Dictionary<string, Type?> _typeCache =
            new Dictionary<string, Type?>(StringComparer.Ordinal);

        /// <summary>
        /// Resolve a BOS Core type by full name, cached for the process
        /// lifetime. Anchors on a known Core type's assembly first to avoid
        /// scanning the AppDomain on hot paths; falls back to a full scan
        /// if the type lives in a sister BOS dll.
        /// </summary>
        private static Type? ResolveType(string fullName)
        {
            lock (_typeCache)
            {
                if (_typeCache.TryGetValue(fullName, out var cached)) return cached;
            }
            // Anchor on a known type's assembly to avoid scanning every loaded
            // assembly. EntityServiceRule lives in the same dll as everything
            // we need (Kingdee.BOS.Core).
            var anchor = typeof(Kingdee.BOS.Core.Metadata.ConvertElement.ConvertRuleMetaData);
            var t = anchor.Assembly.GetType(fullName, throwOnError: false);
            if (t == null)
            {
                // Fallback: scan AppDomain in case future code paths relocate
                // a type to another BOS dll already in the resolver's load set.
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    t = asm.GetType(fullName, throwOnError: false);
                    if (t != null) break;
                }
            }
            lock (_typeCache) { _typeCache[fullName] = t; }
            return t;
        }

        /// <summary>
        /// Reflection setter with type coercion. Skips no-op when
        /// <paramref name="propName"/> is missing or readonly. Wraps strings
        /// into LocaleValue when the property is typed that way (Description
        /// / PreConditionDesc on EntityServiceRule and FormBusinessService);
        /// passes <c>null</c> through for nullable / reference types so
        /// callers can leave optional fields blank.
        /// </summary>
        private static void SetProp(object target, string propName, object? value)
        {
            var prop = target.GetType().GetProperty(propName, BindingFlags.Public | BindingFlags.Instance);
            if (prop == null || !prop.CanWrite) return;
            try
            {
                prop.SetValue(target, ConvertValue(value, prop.PropertyType));
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException(
                    $"SetProp failed on {target.GetType().Name}.{propName}: {ex.Message}", ex);
            }
        }

        /// <summary>
        /// Coerce <paramref name="raw"/> into <paramref name="targetType"/>.
        /// Handles primitives via Convert.ChangeType, nullable wrappers,
        /// already-assignable values, and types with a single string-arg ctor
        /// (LocaleValue's `LocaleValue(string)` overload covers the
        /// description-style fields). null collapses to default(targetType).
        /// </summary>
        private static object? ConvertValue(object? raw, Type targetType)
        {
            if (targetType == null) return raw;

            // Newtonsoft hands us JValue / JArray for json-typed fields when
            // the args DTO is dictionary-shaped; unwrap to underlying CLR
            // value before further coercion.
            if (raw is Newtonsoft.Json.Linq.JValue jv) raw = jv.Value;

            if (raw == null)
            {
                if (targetType.IsValueType && Nullable.GetUnderlyingType(targetType) == null)
                    return Activator.CreateInstance(targetType);
                return null;
            }

            // Already compatible — string→string, int→long via boxing, etc.
            if (targetType.IsInstanceOfType(raw)) return raw;

            var underlying = Nullable.GetUnderlyingType(targetType) ?? targetType;

            if (underlying.IsEnum)
            {
                if (raw is string es) return Enum.Parse(underlying, es, ignoreCase: true);
                return Enum.ToObject(underlying, raw);
            }

            // LocaleValue / similar wrappers — match by single-string-arg ctor.
            if (raw is string sRaw && !underlying.IsPrimitive && underlying != typeof(string))
            {
                var stringCtor = underlying.GetConstructor(new[] { typeof(string) });
                if (stringCtor != null) return stringCtor.Invoke(new object[] { sRaw });
            }

            try
            {
                return Convert.ChangeType(raw, underlying, System.Globalization.CultureInfo.InvariantCulture);
            }
            catch
            {
                // Last-ditch: stringify and try Activator(string) again — covers
                // numbers passed for string-typed fields like ReturnQtyField
                // (decompiled as `string` despite [DefaultValue(1)]).
                if (underlying == typeof(string)) return raw.ToString();
                throw;
            }
        }
    }
}
