using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using Newtonsoft.Json;

namespace OpenDeploy.BosBridge
{
    // ── Business rules (Plan 5.12.3b) ──────────────────────────────
    //
    // Read-only walk over a FormMetadata DCXML. Deserializes via the
    // shared DcxmlSerializer (the same serializer that handles
    // ConvertRuleMetaData), then enumerates BusinessInfo.Entrys for
    // EntityServiceRules and per-Field UpdateActions. Reflection on the
    // BOS types (Entity / Field / EntityServiceRule / FormBusinessService)
    // keeps the bridge from taking compile-time references on more BOS
    // namespaces — only Core / DataEntity / Orm are wired in the csproj.
    //
    // Split out of BosContext.cs after Task 2.1 to keep the partial-class
    // surface focused; Tasks 2.2-2.4 will add add/remove ops alongside the
    // ListBusinessRules walk in this same file.

    internal sealed partial class BosContext
    {
        /// <summary>
        /// Walk the BusinessInfo of a FormMetadata DCXML and emit a typed
        /// summary of every entity-level EntityServiceRule and every
        /// field-level UpdateAction. Used by the agent's
        /// `k3cloud_list_business_rules` tool to inspect what rules already
        /// exist before deciding whether to add or remove. Pure read — does
        /// not re-serialize the input.
        /// </summary>
        public ListBusinessRulesResult ListBusinessRules(string xml)
        {
            if (string.IsNullOrEmpty(xml)) throw new ArgumentException("xml is empty", nameof(xml));
            var formMeta = _serializer.DeserializeFromString(xml)
                ?? throw new InvalidOperationException("DeserializeFromString returned null");

            var businessInfo = formMeta.GetType().GetProperty("BusinessInfo")?.GetValue(formMeta);
            if (businessInfo == null)
            {
                throw new InvalidOperationException(
                    $"input deserialized to {formMeta.GetType().FullName} which has no BusinessInfo");
            }

            var entityRules = new List<EntityRuleSummary>();
            var fieldActions = new List<FieldUpdateActionSummary>();

            foreach (var element in EnumerateBusinessElements(businessInfo))
            {
                var elemKey = ReadStringProperty(element, "Key") ?? string.Empty;

                // Entity-shaped elements (HeadEntity/EntryEntity/SubEntryEntity/...)
                // expose EntityServiceRules. Field-shaped elements expose
                // UpdateActions. A single Element instance never has both —
                // we just blindly probe both properties via reflection.
                if (element.GetType().GetProperty("EntityServiceRules")?.GetValue(element) is IList rules)
                {
                    foreach (var rule in rules)
                    {
                        if (rule == null) continue;
                        entityRules.Add(BuildEntityRuleSummary(rule, elemKey));
                    }
                }

                if (element.GetType().GetProperty("UpdateActions")?.GetValue(element) is IList actions
                    && actions.Count > 0)
                {
                    foreach (var svc in actions)
                    {
                        if (svc == null) continue;
                        fieldActions.Add(BuildFieldUpdateActionSummary(svc, elemKey));
                    }
                }
            }

            return new ListBusinessRulesResult
            {
                EntityRules = entityRules,
                FieldUpdateActions = fieldActions,
            };
        }

        /// <summary>
        /// Append an EntityServiceRule to a target entity's
        /// <c>EntityServiceRules</c> collection. Default target is HeadEntity
        /// when <c>args.EntityKey</c> is null/empty; per Tier B recon
        /// (`docs/recon/2026-05-04-business-rules-tier-b.md` §2) BOS Designer
        /// always lands user-configured rules on HeadEntity even when the UI
        /// surfaces them under a child entity. Each service in
        /// <c>args.Services</c> is instantiated by short class name via the
        /// cached <see cref="ServiceMetaTypes"/> index (covers
        /// FormBusinessService base + every concrete subclass like
        /// GetInvStockBusinessServiceMeta), and arbitrary string/int/long/bool
        /// properties are reflected on with <see cref="ConvertValue"/> for
        /// scalar coercion. Returns the re-serialized DCXML.
        /// </summary>
        public string AddEntityServiceRule(string xml, AddEntityServiceRuleArgs args)
        {
            if (string.IsNullOrEmpty(xml)) throw new ArgumentException("xml is empty", nameof(xml));
            if (args == null) throw new ArgumentException("args is null", nameof(args));
            if (string.IsNullOrEmpty(args.RuleId)) throw new ArgumentException("ruleId is empty", nameof(args));
            if (string.IsNullOrWhiteSpace(args.PreCondition))
                throw new ArgumentException(
                    "preCondition must be non-empty (BOS Designer enforces this on EntityServiceRule)",
                    nameof(args));

            var formMeta = _serializer.DeserializeFromString(xml)
                ?? throw new InvalidOperationException("DeserializeFromString returned null");

            var businessInfo = formMeta.GetType().GetProperty("BusinessInfo")?.GetValue(formMeta)
                ?? throw new InvalidOperationException(
                    $"input deserialized to {formMeta.GetType().FullName} which has no BusinessInfo");

            var entity = FindEntity(businessInfo, args.EntityKey)
                ?? throw new InvalidOperationException(
                    string.IsNullOrEmpty(args.EntityKey)
                        ? "no HeadEntity found in BusinessInfo (default target)"
                        : $"no entity with Key='{args.EntityKey}' (and no fallback HeadEntity match)");

            var rulesList = GetOrCreateEntityServiceRules(entity);

            var ruleType = ResolveType("Kingdee.BOS.Core.Metadata.EntityElement.EntityServiceRule")
                ?? throw new InvalidOperationException(
                    "Kingdee.BOS.Core.Metadata.EntityElement.EntityServiceRule not found in BOS Core");
            var rule = Activator.CreateInstance(ruleType)!;
            SetProp(rule, "Id", args.RuleId);
            SetProp(rule, "Description", args.Description);
            SetProp(rule, "PreCondition", args.PreCondition);
            SetProp(rule, "PreConditionDesc", args.PreConditionDesc);
            SetProp(rule, "Seq", rulesList.Count + 1);

            // EntityServiceRule's ctor pre-initializes WhenTrueBusinessServices
            // / WhenFalseBusinessServices to non-null FormBusinessServiceCollection
            // instances (decompiled at .scratch/decompile/EntityServiceRule.cs:159-165),
            // so we can pull the existing list directly. Fall back to building
            // one only if a future BOS revision changes that contract.
            var servicesProp = ruleType.GetProperty("WhenTrueBusinessServices")
                ?? throw new InvalidOperationException("EntityServiceRule.WhenTrueBusinessServices not found");
            var servicesList = servicesProp.GetValue(rule) as IList;
            if (servicesList == null)
            {
                servicesList = (IList)Activator.CreateInstance(servicesProp.PropertyType)!;
                servicesProp.SetValue(rule, servicesList);
            }

            if (args.Services != null)
            {
                foreach (var svc in args.Services)
                {
                    if (svc == null) continue;
                    if (string.IsNullOrEmpty(svc.ClassName))
                        throw new ArgumentException("services[].className is empty");
                    var svcType = ResolveServiceMetaType(svc.ClassName);
                    var instance = Activator.CreateInstance(svcType)!;

                    SetProp(instance, "Id", Guid.NewGuid().ToString("N"));
                    // ActionId on subclasses (e.g. GetInvStock) is hard-defaulted
                    // to 67; setting it explicitly is harmless and keeps base
                    // FormBusinessService (Calculate=2) working too.
                    SetProp(instance, "ActionId", svc.ActionId);

                    if (svc.Properties != null)
                    {
                        foreach (var kv in svc.Properties)
                        {
                            var prop = svcType.GetProperty(
                                kv.Key,
                                BindingFlags.Public | BindingFlags.Instance);
                            if (prop == null || !prop.CanWrite) continue;
                            try
                            {
                                prop.SetValue(instance, ConvertValue(kv.Value, prop.PropertyType));
                            }
                            catch (Exception ex)
                            {
                                throw new InvalidOperationException(
                                    $"failed to set {svc.ClassName}.{kv.Key}: {ex.Message}", ex);
                            }
                        }
                    }
                    servicesList.Add(instance);
                }
            }

            rulesList.Add(rule);
            return _serializer.SerializeToString(formMeta, null);
        }

        /// <summary>
        /// Yield every Element exposed by the BusinessInfo. After full
        /// initialization (BusinessInfo.EndInit) entities live in <c>Entrys</c>
        /// and fields/forms in <c>_elements</c>; while DCXML is still being
        /// deserialized everything sits in <c>_serElements</c> which is what
        /// the public <c>Elements</c> getter returns. Iterate Elements first
        /// (covers the deserialize-not-yet-complete path that DcxmlSerializer
        /// leaves us in), then Entrys to cover any post-init callers.
        /// </summary>
        private static IEnumerable<object> EnumerateBusinessElements(object businessInfo)
        {
            var seen = new HashSet<object>(ReferenceEqualityComparer.Instance);

            var elements = businessInfo.GetType().GetProperty("Elements")?.GetValue(businessInfo) as IEnumerable;
            if (elements != null)
            {
                foreach (var e in elements)
                {
                    if (e == null) continue;
                    if (seen.Add(e)) yield return e;
                }
            }

            var entrys = businessInfo.GetType().GetProperty("Entrys")?.GetValue(businessInfo) as IEnumerable;
            if (entrys != null)
            {
                foreach (var e in entrys)
                {
                    if (e == null) continue;
                    if (seen.Add(e)) yield return e;
                    // Entity exposes Fields — also surface them so post-init
                    // callers (where _serElements has been nulled out) still
                    // see field-level UpdateActions.
                    if (e.GetType().GetProperty("Fields")?.GetValue(e) is IEnumerable fields)
                    {
                        foreach (var f in fields)
                        {
                            if (f == null) continue;
                            if (seen.Add(f)) yield return f;
                        }
                    }
                }
            }
        }

        private sealed class ReferenceEqualityComparer : IEqualityComparer<object>
        {
            public static readonly ReferenceEqualityComparer Instance = new ReferenceEqualityComparer();
            public new bool Equals(object? x, object? y) => ReferenceEquals(x, y);
            public int GetHashCode(object obj) => System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(obj);
        }

        private static EntityRuleSummary BuildEntityRuleSummary(object rule, string entityKey)
        {
            var summary = new EntityRuleSummary
            {
                RuleId = ReadStringProperty(rule, "Id") ?? string.Empty,
                EntityKey = entityKey,
                PreCondition = ReadStringProperty(rule, "PreCondition") ?? string.Empty,
                PreConditionDesc = ReadLocaleValueText(rule, "PreConditionDesc"),
                Description = ReadLocaleValueText(rule, "Description"),
                Seq = ReadIntProperty(rule, "Seq"),
                Services = new List<ServiceSummary>(),
            };

            AppendServices(rule, "WhenTrueBusinessServices", "whenTrue", summary.Services);
            AppendServices(rule, "WhenFalseBusinessServices", "whenFalse", summary.Services);

            return summary;
        }

        private static void AppendServices(
            object rule,
            string propName,
            string branch,
            List<ServiceSummary> sink)
        {
            if (!(rule.GetType().GetProperty(propName)?.GetValue(rule) is IEnumerable services)) return;
            foreach (var svc in services)
            {
                if (svc == null) continue;
                sink.Add(new ServiceSummary
                {
                    Branch = branch,
                    ActionId = ReadLongProperty(svc, "ActionId"),
                    // Wire format uses the runtime class name as the XML
                    // element (`<GetInvStockBusinessServiceMeta>` not
                    // `<FormBusinessService><ClassName>...</ClassName>`).
                    // Surface the class name so callers can distinguish base
                    // FormBusinessService (Calculate=2 by convention) from
                    // its specialized subclasses.
                    ClassName = svc.GetType().Name,
                    ServiceId = ReadStringProperty(svc, "Id") ?? string.Empty,
                    Description = ReadLocaleValueText(svc, "Description"),
                    Parameters = ReadStringProperty(svc, "Parameters"),
                });
            }
        }

        private static FieldUpdateActionSummary BuildFieldUpdateActionSummary(object svc, string fieldKey)
        {
            return new FieldUpdateActionSummary
            {
                FieldKey = fieldKey,
                ActionId = ReadLongProperty(svc, "ActionId"),
                ClassName = svc.GetType().Name,
                ServiceId = ReadStringProperty(svc, "Id") ?? string.Empty,
                Description = ReadLocaleValueText(svc, "Description"),
                Parameters = ReadStringProperty(svc, "Parameters"),
            };
        }

        private static string? ReadStringProperty(object obj, string name)
        {
            var prop = obj.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (prop == null) return null;
            try { return prop.GetValue(obj) as string; }
            catch { return null; }
        }

        private static int ReadIntProperty(object obj, string name)
        {
            var prop = obj.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (prop == null) return 0;
            try
            {
                var raw = prop.GetValue(obj);
                if (raw == null) return 0;
                return Convert.ToInt32(raw, System.Globalization.CultureInfo.InvariantCulture);
            }
            catch { return 0; }
        }

        private static long ReadLongProperty(object obj, string name)
        {
            var prop = obj.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (prop == null) return 0;
            try
            {
                var raw = prop.GetValue(obj);
                if (raw == null) return 0;
                return Convert.ToInt64(raw, System.Globalization.CultureInfo.InvariantCulture);
            }
            catch { return 0; }
        }

        private static string? ReadLocaleValueText(object obj, string name)
        {
            // Description / PreConditionDesc are typed `LocaleValue`
            // (Kingdee.BOS.Util) — a Dictionary<int,string>-shaped wrapper.
            // For the summary we just want the human-readable string;
            // ToString() on LocaleValue returns the current-culture value.
            var prop = obj.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (prop == null) return null;
            try
            {
                var raw = prop.GetValue(obj);
                if (raw == null) return null;
                if (raw is string s) return s;
                return raw.ToString();
            }
            catch { return null; }
        }

        // JsonProperty annotations force camelCase wire names — the bridge's
        // JToken.FromObject(result) path otherwise uses C# property casing
        // (PascalCase), which mismatches Node-side TypeScript callers.

        public sealed class ListBusinessRulesResult
        {
            [JsonProperty("entityRules")]
            public List<EntityRuleSummary> EntityRules { get; set; } = new List<EntityRuleSummary>();

            [JsonProperty("fieldUpdateActions")]
            public List<FieldUpdateActionSummary> FieldUpdateActions { get; set; } = new List<FieldUpdateActionSummary>();
        }

        public sealed class EntityRuleSummary
        {
            [JsonProperty("ruleId")]
            public string RuleId { get; set; } = string.Empty;

            [JsonProperty("entityKey")]
            public string EntityKey { get; set; } = string.Empty;

            [JsonProperty("preCondition")]
            public string PreCondition { get; set; } = string.Empty;

            [JsonProperty("preConditionDesc")]
            public string? PreConditionDesc { get; set; }

            [JsonProperty("description")]
            public string? Description { get; set; }

            [JsonProperty("seq")]
            public int Seq { get; set; }

            [JsonProperty("services")]
            public List<ServiceSummary> Services { get; set; } = new List<ServiceSummary>();
        }

        public sealed class ServiceSummary
        {
            [JsonProperty("branch")]
            public string Branch { get; set; } = "whenTrue";

            [JsonProperty("actionId")]
            public long ActionId { get; set; }

            [JsonProperty("className")]
            public string ClassName { get; set; } = string.Empty;

            [JsonProperty("serviceId")]
            public string ServiceId { get; set; } = string.Empty;

            [JsonProperty("description")]
            public string? Description { get; set; }

            [JsonProperty("parameters")]
            public string? Parameters { get; set; }
        }

        public sealed class FieldUpdateActionSummary
        {
            [JsonProperty("fieldKey")]
            public string FieldKey { get; set; } = string.Empty;

            [JsonProperty("actionId")]
            public long ActionId { get; set; }

            [JsonProperty("className")]
            public string ClassName { get; set; } = string.Empty;

            [JsonProperty("serviceId")]
            public string ServiceId { get; set; } = string.Empty;

            [JsonProperty("description")]
            public string? Description { get; set; }

            [JsonProperty("parameters")]
            public string? Parameters { get; set; }
        }

        // ── add/modify helpers (Tasks 2.2-2.4 share these) ────────────────

        /// <summary>
        /// Locate a BusinessInfo entity by Key. When <paramref name="entityKey"/>
        /// is null/empty, falls back to the first element whose runtime type
        /// name ends in "HeadEntity" — DCXML <c>ElementType="34"</c> per Tier B
        /// recon §2. Reuses <see cref="EnumerateBusinessElements"/> so the
        /// ReferenceEqualityComparer dedup carries over (Task 2.1 quirk #3 in
        /// `bos_form_metadata_deserialize_quirks.md`).
        /// </summary>
        private static object? FindEntity(object businessInfo, string? entityKey)
        {
            var wantHead = string.IsNullOrEmpty(entityKey);

            // Pass 1 — exact Key match (skip elements without
            // EntityServiceRules; HeadEntity / EntryEntity / SubEntryEntity
            // all have it, plain Form / fields don't).
            if (!wantHead)
            {
                foreach (var element in EnumerateBusinessElements(businessInfo))
                {
                    if (element.GetType().GetProperty("EntityServiceRules") == null) continue;
                    var key = ReadStringProperty(element, "Key");
                    if (string.Equals(key, entityKey, StringComparison.Ordinal)) return element;
                }
                // No exact match — caller decides whether to fall back; we
                // intentionally do NOT auto-fallback to HeadEntity here, so
                // callers can detect "user gave a bad entityKey" vs "user
                // omitted entityKey".
                return null;
            }

            // Pass 2 — head-entity default. Match by runtime type name
            // (`*.HeadEntity`) to avoid a compile-time dep on
            // Kingdee.BOS.Core.Metadata.EntityElement.HeadEntity in csproj.
            foreach (var element in EnumerateBusinessElements(businessInfo))
            {
                if (element.GetType().GetProperty("EntityServiceRules") == null) continue;
                var typeName = element.GetType().Name;
                if (typeName == "HeadEntity") return element;
            }
            return null;
        }

        /// <summary>
        /// Pull (or, defensively, create) the entity's EntityServiceRules
        /// collection. EntityServiceRule's ctor and Entity's ctor both
        /// pre-init the collection; the create-and-set-back path is a
        /// belt-and-suspenders fallback for unfamiliar entity subclasses.
        /// </summary>
        private static IList GetOrCreateEntityServiceRules(object entity)
        {
            var prop = entity.GetType().GetProperty("EntityServiceRules", BindingFlags.Public | BindingFlags.Instance)
                ?? throw new InvalidOperationException(
                    $"{entity.GetType().FullName} has no EntityServiceRules property");
            var list = prop.GetValue(entity) as IList;
            if (list != null) return list;
            list = (IList)Activator.CreateInstance(prop.PropertyType)!;
            prop.SetValue(entity, list);
            return list;
        }

        private static readonly Lazy<Dictionary<string, Type>> ServiceMetaTypes =
            new Lazy<Dictionary<string, Type>>(BuildServiceMetaIndex);

        private static Type ResolveServiceMetaType(string shortName)
        {
            if (!ServiceMetaTypes.Value.TryGetValue(shortName, out var t))
                throw new InvalidOperationException(
                    $"unknown service class '{shortName}' — not a subclass of FormBusinessService loaded in BOS Core");
            return t;
        }

        private static Dictionary<string, Type> BuildServiceMetaIndex()
        {
            var baseType = ResolveType("Kingdee.BOS.Core.Metadata.FormElement.FormBusinessService")
                ?? throw new InvalidOperationException(
                    "Kingdee.BOS.Core.Metadata.FormElement.FormBusinessService not found in BOS Core");

            // Walk the assembly that declares the base class — concrete
            // service-meta subclasses (GetInvStockBusinessServiceMeta,
            // GetPriceMeta, etc.) live in adjacent BusinessService /
            // FormElement namespaces in the same Kingdee.BOS.Core.dll.
            // SafeGetTypes is shared with BosContext.cs (same partial class),
            // so naming conflicts are avoided by reusing that one.
            var index = new Dictionary<string, Type>(StringComparer.Ordinal);
            foreach (var t in SafeGetTypes(baseType.Assembly))
            {
                if (t == null || !t.IsClass || t.IsAbstract) continue;
                if (!baseType.IsAssignableFrom(t)) continue;
                // First-write-wins on name collision (defensive — class names
                // should be unique in BOS Core but this keeps build-time noise
                // from poisoning the cache).
                if (!index.ContainsKey(t.Name)) index[t.Name] = t;
            }
            // Also include the base type itself — Calculate (ActionId=2) uses
            // FormBusinessService directly, no ClassName subclass.
            if (!index.ContainsKey(baseType.Name)) index[baseType.Name] = baseType;
            return index;
        }

        private static readonly Dictionary<string, Type?> _typeCache =
            new Dictionary<string, Type?>(StringComparer.Ordinal);

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

        // ── args DTOs (deserialized from Program.cs Dispatch) ─────────────

        internal sealed class AddEntityServiceRuleArgs
        {
            [JsonProperty("ruleId")]
            public string RuleId { get; set; } = string.Empty;

            [JsonProperty("description")]
            public string? Description { get; set; }

            [JsonProperty("preCondition")]
            public string PreCondition { get; set; } = string.Empty;

            [JsonProperty("preConditionDesc")]
            public string? PreConditionDesc { get; set; }

            [JsonProperty("entityKey")]
            public string? EntityKey { get; set; }

            [JsonProperty("services")]
            public List<ServiceArg>? Services { get; set; } = new List<ServiceArg>();
        }

        internal sealed class ServiceArg
        {
            [JsonProperty("className")]
            public string ClassName { get; set; } = string.Empty;

            [JsonProperty("actionId")]
            public long ActionId { get; set; }

            [JsonProperty("properties")]
            public Dictionary<string, object?>? Properties { get; set; }
        }
    }
}
