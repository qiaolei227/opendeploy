using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
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
