using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Kingdee.BOS.Core.Metadata.ConvertElement;
using Kingdee.BOS.Orm.Metadata.DataEntity;
using Kingdee.BOS.Orm.Metadata.DataEntity.CLR;
using Kingdee.BOS.Serialization;
using FormPlugIn = Kingdee.BOS.Core.Metadata.FormElement.PlugIn;

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
            var binder = new TolerantListBinder(schemas);
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
        /// null/empty to target the header-level policy.
        /// </summary>
        public string AddConvertFieldMap(
            string xml,
            string targetFieldKey,
            string sourceFieldKey,
            string mode,
            string? formula,
            string? targetEntryKey)
        {
            if (string.IsNullOrEmpty(targetFieldKey)) throw new ArgumentException("target_field_key is empty", nameof(targetFieldKey));
            if (string.IsNullOrEmpty(sourceFieldKey) && string.IsNullOrEmpty(formula))
                throw new ArgumentException("either source_field_key or formula must be provided");

            return PatchMeta(xml, meta =>
            {
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
            });
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
        /// for GroupByField pass field1..field3; for GroupByFormula pass `formula`.
        /// </summary>
        public string SetConvertGroupBy(
            string xml,
            string mode,
            string? field1,
            string? field2,
            string? field3,
            string? formula)
        {
            return PatchMeta(xml, meta =>
            {
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
            });
        }

        /// <summary>
        /// Set the alert message and/or IronPython filter expression on the
        /// ConvertFilterPolicy. Pass null to leave a field unchanged.
        /// </summary>
        public string SetConvertFilter(
            string xml,
            string? alertMessage,
            string? custFilter)
        {
            if (alertMessage == null && custFilter == null)
                throw new ArgumentException("at least one of alert_message or cust_filter must be provided");

            return PatchMeta(xml, meta =>
            {
                ConvertFilterPolicyElement? policy = null;
                foreach (var p in meta.Rule.Policies)
                {
                    if (p is ConvertFilterPolicyElement fp) { policy = fp; break; }
                }
                if (policy == null) throw new InvalidOperationException("no ConvertFilterPolicy in rule");

                if (alertMessage != null) policy.AlertMessageView = alertMessage;
                if (custFilter != null) policy.CustFilter = custFilter;
            });
        }

        /// <summary>
        /// Append a service plugin class to the ConvertPlugInPolicy.
        /// Idempotent — if the class is already registered, no-op.
        /// </summary>
        public string AddConvertPlugin(string xml, string className)
        {
            if (string.IsNullOrEmpty(className)) throw new ArgumentException("class_name is empty", nameof(className));

            return PatchMeta(xml, meta =>
            {
                ConvertPlugInPolicyElement? policy = null;
                foreach (var p in meta.Rule.Policies)
                {
                    if (p is ConvertPlugInPolicyElement pp) { policy = pp; break; }
                }
                if (policy == null) throw new InvalidOperationException("no ConvertPlugInPolicy in rule");

                if (policy.Plugs == null) policy.Plugs = new List<FormPlugIn>();
                if (policy.Plugs.Any(p => p.ClassName == className)) return;

                policy.Plugs.Add(new FormPlugIn(className)
                {
                    ClassName = className,
                    PlugInType = FormPlugIn.PlugInType_ServicePlugIn,
                    IsEnabled = true,
                });
            });
        }

        /// <summary>
        /// Remove a plugin class from the ConvertPlugInPolicy by ClassName.
        /// No-op if the class is not present.
        /// </summary>
        public string RemoveConvertPlugin(string xml, string className)
        {
            if (string.IsNullOrEmpty(className)) throw new ArgumentException("class_name is empty", nameof(className));

            return PatchMeta(xml, meta =>
            {
                ConvertPlugInPolicyElement? policy = null;
                foreach (var p in meta.Rule.Policies)
                {
                    if (p is ConvertPlugInPolicyElement pp) { policy = pp; break; }
                }
                if (policy == null) throw new InvalidOperationException("no ConvertPlugInPolicy in rule");

                policy.Plugs?.RemoveAll(p => p.ClassName == className);
            });
        }

        /// <summary>
        /// Append a source→target bill-type mapping to the BillTypeMapPolicy.
        /// Idempotent — if an identical mapping already exists, no-op.
        /// </summary>
        public string AddConvertBillTypeMap(
            string xml,
            string sourceBillTypeId,
            string targetBillTypeId)
        {
            return PatchMeta(xml, meta =>
            {
                BillTypeMapPolicyElement? policy = null;
                foreach (var p in meta.Rule.Policies)
                {
                    if (p is BillTypeMapPolicyElement bp) { policy = bp; break; }
                }
                if (policy == null) throw new InvalidOperationException("no BillTypeMapPolicy in rule");

                foreach (var m in policy.BillTypeMaps)
                {
                    if (m.SourceBillTypeId == sourceBillTypeId && m.TargetBillTypeId == targetBillTypeId) return;
                }

                var key = $"{sourceBillTypeId}_{targetBillTypeId}";
                policy.BillTypeMaps.Add(new BillTypeMapElement(key)
                {
                    SourceBillTypeId = sourceBillTypeId,
                    TargetBillTypeId = targetBillTypeId,
                });
            });
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

        /// <summary>
        /// Deserialize <paramref name="xml"/> to a ConvertRuleMetaData, apply
        /// <paramref name="patch"/>, and re-serialize. Centralizes the
        /// deserialize-patch-serialize triple used by every patch operation.
        /// </summary>
        private string PatchMeta(string xml, Action<ConvertRuleMetaData> patch)
        {
            if (string.IsNullOrEmpty(xml)) throw new ArgumentException("xml is empty", nameof(xml));
            var meta = _serializer.DeserializeFromString(xml) as ConvertRuleMetaData
                ?? throw new InvalidOperationException("input XML did not deserialize to ConvertRuleMetaData");
            patch(meta);
            return _serializer.SerializeToString(meta, null);
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
                return ex.Types.Where(t => t != null)!;
            }
        }
    }
}
