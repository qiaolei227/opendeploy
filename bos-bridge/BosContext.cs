using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using Kingdee.BOS.Core.Metadata.ConvertElement;
using Kingdee.BOS.Orm.Metadata.DataEntity;
using Kingdee.BOS.Orm.Metadata.DataEntity.CLR;
using Kingdee.BOS.Serialization;

namespace OpenDeploy.BosBridge
{
    /// <summary>
    /// One-shot initialization of the BOS schema universe + a long-lived
    /// DcxmlSerializer wired with TolerantListBinder. Cached for the whole
    /// process — building 1200+ schemas is expensive (~hundreds of ms);
    /// every NDJSON request reuses the same instance.
    /// </summary>
    internal sealed class BosContext
    {
        public string DataEntityVersion { get; }
        public string CoreVersion { get; }
        public int RegisteredSchemas { get; }

        private readonly DcxmlSerializer _serializer;

        private BosContext(string dataVer, string coreVer, int schemas, DcxmlSerializer serializer)
        {
            DataEntityVersion = dataVer;
            CoreVersion = coreVer;
            RegisteredSchemas = schemas;
            _serializer = serializer;
        }

        public static BosContext Initialize(DllResolver resolver)
        {
            var dataAsm = resolver.LoadAssembly("Kingdee.BOS.DataEntity");
            var coreAsm = resolver.LoadAssembly("Kingdee.BOS.Core");

            var schemas = CollectSerializableSchemas(coreAsm);
            var binder = new TolerantListBinder(Cast(schemas));
            var serializer = new DcxmlSerializer(binder)
            {
                ColloctionIgnorePKValue = true,
            };

            return new BosContext(
                dataAsm.GetName().Version?.ToString() ?? "?",
                coreAsm.GetName().Version?.ToString() ?? "?",
                schemas.Count,
                serializer);
        }

        /// <summary>
        /// Round-trip a captured ConvertRule XML through DcxmlSerializer to
        /// produce canonical DCXML — equivalent in structure but with
        /// default-value attributes (ElementType, ElementStyle) omitted per
        /// format spec. Used to replace hand-captured baselines in
        /// SaveRulesV9: any origin from `getConvertRule` can be normalized
        /// without per-rule baseline capture.
        /// </summary>
        public string NormalizeConvertRule(string xml)
        {
            if (string.IsNullOrEmpty(xml)) throw new ArgumentException("xml is empty", nameof(xml));
            var obj = _serializer.DeserializeFromString(xml);
            if (obj == null) throw new InvalidOperationException("DeserializeFromString returned null");
            return _serializer.SerializeToString(obj, null);
        }

        /// <summary>
        /// Append a FieldMap to a ConvertRuleMetaData's DefaultConvertPolicy and
        /// re-serialize. Picks the policy whose TargetEntryKey matches; pass
        /// null/empty to target the header-level policy. Used by Plan 5.12.4
        /// v2 Task 3 (字段映射) to patch an existing extension XML.
        /// </summary>
        public string AddConvertFieldMap(
            string xml,
            string targetFieldKey,
            string sourceFieldKey,
            string mode,
            string? formula,
            string? targetEntryKey)
        {
            if (string.IsNullOrEmpty(xml)) throw new ArgumentException("xml is empty", nameof(xml));
            if (string.IsNullOrEmpty(targetFieldKey)) throw new ArgumentException("target_field_key is empty", nameof(targetFieldKey));
            if (string.IsNullOrEmpty(sourceFieldKey) && string.IsNullOrEmpty(formula))
                throw new ArgumentException("either source_field_key or formula must be provided");

            var meta = _serializer.DeserializeFromString(xml) as ConvertRuleMetaData
                ?? throw new InvalidOperationException("input XML did not deserialize to ConvertRuleMetaData");

            var policy = FindDefaultConvertPolicy(meta, targetEntryKey);
            if (policy == null)
            {
                var key = string.IsNullOrEmpty(targetEntryKey) ? "(header)" : targetEntryKey!;
                throw new InvalidOperationException($"no DefaultConvertPolicy with TargetEntryKey={key}");
            }

            ValueConvertMode parsedMode;
            try { parsedMode = (ValueConvertMode)Enum.Parse(typeof(ValueConvertMode), mode, ignoreCase: true); }
            catch (Exception ex) { throw new ArgumentException($"invalid mode '{mode}': {ex.Message}", nameof(mode)); }

            var fm = new FieldMapElement(BuildFieldMapKey(targetFieldKey, sourceFieldKey, formula))
            {
                TargetFieldKey = targetFieldKey,
                SourceFieldKey = sourceFieldKey ?? string.Empty,
                ValueConvertMode = parsedMode,
                Formula = formula ?? string.Empty,
            };
            policy.FieldMaps.Add(fm);

            return _serializer.SerializeToString(meta, null);
        }

        private static DefaultConvertPolicyElement? FindDefaultConvertPolicy(
            ConvertRuleMetaData meta,
            string? targetEntryKey)
        {
            foreach (var p in meta.Rule.Policies)
            {
                if (p is DefaultConvertPolicyElement dcp)
                {
                    if (string.IsNullOrEmpty(targetEntryKey))
                    {
                        if (string.IsNullOrEmpty(dcp.TargetEntryKey)) return dcp;
                    }
                    else if (dcp.TargetEntryKey == targetEntryKey)
                    {
                        return dcp;
                    }
                }
            }
            return null;
        }

        /// <summary>
        /// Replace the rule-level GroupBy policy (one per ConvertRule). Mode
        /// must be one of None / OneToOne / GroupByField / GroupByFormula;
        /// for GroupByField pass field1..field3 (comma-joined into the
        /// single field slot if you have more than 3); for GroupByFormula
        /// pass `formula`. Plan 5.12.4 v2 Task 4 (策略配置).
        /// </summary>
        public string SetConvertGroupBy(
            string xml,
            string mode,
            string? field1,
            string? field2,
            string? field3,
            string? formula)
        {
            if (string.IsNullOrEmpty(xml)) throw new ArgumentException("xml is empty", nameof(xml));

            var meta = _serializer.DeserializeFromString(xml) as ConvertRuleMetaData
                ?? throw new InvalidOperationException("input XML did not deserialize to ConvertRuleMetaData");

            ConvertGroupByPolicyElement? policy = null;
            foreach (var p in meta.Rule.Policies)
            {
                if (p is ConvertGroupByPolicyElement gp) { policy = gp; break; }
            }
            if (policy == null) throw new InvalidOperationException("no ConvertGroupByPolicy in rule");

            GroupByMode parsed;
            try { parsed = (GroupByMode)Enum.Parse(typeof(GroupByMode), mode, ignoreCase: true); }
            catch (Exception ex) { throw new ArgumentException($"invalid GroupByMode '{mode}': {ex.Message}", nameof(mode)); }

            policy.GroupByMode = parsed;
            policy.GroupByField = field1 ?? string.Empty;
            policy.GroupByField2 = field2 ?? string.Empty;
            policy.GroupByField3 = field3 ?? string.Empty;
            policy.GroupByFormula = formula ?? string.Empty;

            return _serializer.SerializeToString(meta, null);
        }

        private static string BuildFieldMapKey(string targetFieldKey, string? sourceFieldKey, string? formula)
        {
            // Mirror BOS Designer's pattern: target_source for plain maps,
            // target_<formula-hash> for formula maps. The exact key only
            // matters for diff detection on subsequent Save calls.
            if (!string.IsNullOrEmpty(formula))
                return $"{targetFieldKey}_F{Math.Abs(formula!.GetHashCode()):X}";
            return $"{targetFieldKey}_{sourceFieldKey ?? "auto"}";
        }

        // ── helpers ────────────────────────────────────────────────────

        private static List<IDataEntityType> CollectSerializableSchemas(Assembly coreAsm)
        {
            var byName = new Dictionary<string, IDataEntityType>(StringComparer.Ordinal);
            foreach (var t in SafeGetTypes(coreAsm))
            {
                if (!t.IsClass || t.IsAbstract || t.IsGenericTypeDefinition) continue;
                if (!t.IsSerializable) continue;
                IDataEntityType? schema;
                try { schema = DataEntityType.GetDataEntityType(t); }
                catch { continue; }
                if (schema == null || string.IsNullOrEmpty(schema.Name)) continue;
                // First-write-wins on name collision — BOS.Core has a few
                // duplicate class names across namespaces and ListDcxmlBinder
                // builds a flat name→type dict.
                if (!byName.ContainsKey(schema.Name)) byName[schema.Name] = schema;
            }
            return new List<IDataEntityType>(byName.Values);
        }

        private static IEnumerable<Type> SafeGetTypes(Assembly asm)
        {
            try { return asm.GetTypes(); }
            catch (ReflectionTypeLoadException ex)
            {
                var loaded = new List<Type>();
                foreach (var t in ex.Types) if (t != null) loaded.Add(t);
                return loaded;
            }
        }

        private static IEnumerable<IDataEntityType> Cast(List<IDataEntityType> schemas) => schemas;
    }
}
