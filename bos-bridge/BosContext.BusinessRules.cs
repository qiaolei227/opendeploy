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
    }
}
