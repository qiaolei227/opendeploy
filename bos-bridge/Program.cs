using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;

namespace OpenDeploy.BosBridge
{
    /// <summary>
    /// Phase 2 probe: deserialize a captured BOS convert-rule XML via DcxmlSerializer
    /// then re-serialize it, character-comparing the result against the input.
    /// Reflection-only — no compile-time reference to Kingdee DLLs (they live on
    /// the customer machine, version varies, never bundled).
    ///
    /// Usage:
    ///   opendeploy-bos-serializer.exe                          (schema probe)
    ///   opendeploy-bos-serializer.exe roundtrip &lt;input.xml&gt; [output.xml]
    /// </summary>
    internal static class Program
    {
        private static int Main(string[] args)
        {
            var resolver = DllResolver.Create();
            if (resolver.InstallPath == null)
            {
                Console.Error.WriteLine("install_path: <not found>");
                Console.Error.WriteLine("set BOS_BRIDGE_DESKCLIENT to the K3CloudClient directory");
                return 1;
            }
            resolver.Hook();

            try
            {
                var dataAsm = resolver.LoadAssembly("Kingdee.BOS.DataEntity");
                var coreAsm = resolver.LoadAssembly("Kingdee.BOS.Core");

                if (args.Length >= 2 && args[0] == "roundtrip")
                {
                    return Roundtrip(dataAsm, coreAsm, args[1], args.Length >= 3 ? args[2] : null);
                }

                return SchemaProbe(dataAsm, coreAsm);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"failed: {ex.GetType().FullName}: {ex.Message}");
                for (var inner = ex.InnerException; inner != null; inner = inner.InnerException)
                {
                    Console.Error.WriteLine($"  caused by: {inner.GetType().FullName}: {inner.Message}");
                    if (inner.StackTrace != null)
                        Console.Error.WriteLine(inner.StackTrace);
                }
                return 3;
            }
        }

        private static int SchemaProbe(Assembly dataAsm, Assembly coreAsm)
        {
            Console.WriteLine($"data_entity_version: {dataAsm.GetName().Version}");
            Console.WriteLine($"bos_core_version: {coreAsm.GetName().Version}");
            var schema = BuildConvertRuleSchema(dataAsm, coreAsm);
            var schemaType = schema.GetType();
            var name = schemaType.GetProperty("Name")?.GetValue(schema);
            var properties = schemaType.GetProperty("Properties")?.GetValue(schema);
            var count = properties?.GetType().GetProperty("Count")?.GetValue(properties);
            Console.WriteLine($"convert_rule_schema: type={schemaType.FullName} name={name} properties={count}");
            return 0;
        }

        private static int Roundtrip(Assembly dataAsm, Assembly coreAsm, string inputPath, string? outputPath)
        {
            var inputXml = File.ReadAllText(inputPath, Encoding.UTF8);
            Console.WriteLine($"input_chars: {inputXml.Length}");

            var schemas = CollectConvertElementSchemas(dataAsm, coreAsm);
            Console.WriteLine($"registered_schemas: {schemas.Count}");
            var serializer = BuildSerializerFromList(dataAsm, schemas);
            var serializerType = serializer.GetType();
            serializerType.GetProperty("ColloctionIgnorePKValue")?.SetValue(serializer, true);

            var deserialize = serializerType.GetMethod("DeserializeFromString", new[] { typeof(string), typeof(object) })
                ?? throw new InvalidOperationException("DeserializeFromString(string, object) not found");
            var obj = deserialize.Invoke(serializer, new object?[] { inputXml, null });
            if (obj == null) throw new InvalidOperationException("DeserializeFromString returned null");
            Console.WriteLine($"deserialized_type: {obj.GetType().FullName}");

            var serialize = serializerType.GetMethod("SerializeToString", new[] { typeof(object), typeof(object) })
                ?? throw new InvalidOperationException("SerializeToString(object, object) not found");
            var outputXml = (string?)serialize.Invoke(serializer, new[] { obj, null! });
            if (outputXml == null) throw new InvalidOperationException("SerializeToString returned null");
            Console.WriteLine($"output_chars: {outputXml.Length}");

            if (outputPath != null)
            {
                File.WriteAllText(outputPath, outputXml, new UTF8Encoding(false));
                Console.WriteLine($"output_path: {outputPath}");
            }

            var match = string.Equals(inputXml, outputXml, StringComparison.Ordinal);
            Console.WriteLine($"roundtrip: {(match ? "EXACT" : "DIVERGED")}");
            if (!match) ReportFirstDiff(inputXml, outputXml);
            return match ? 0 : 4;
        }

        private static object BuildConvertRuleSchema(Assembly dataAsm, Assembly coreAsm)
        {
            var convertRuleClr = coreAsm.GetType("Kingdee.BOS.Core.Metadata.ConvertElement.ConvertRuleMetaData", throwOnError: true)!;
            var dtClass = dataAsm.GetType("Kingdee.BOS.Orm.Metadata.DataEntity.CLR.DataEntityType", throwOnError: true)!;
            var getDt = dtClass.GetMethod("GetDataEntityType", BindingFlags.Public | BindingFlags.Static)
                ?? throw new InvalidOperationException("GetDataEntityType(Type) not found");
            return getDt.Invoke(null, new object[] { convertRuleClr })
                ?? throw new InvalidOperationException("GetDataEntityType returned null");
        }

        private static object BuildSerializerFromList(Assembly dataAsm, IList schemas)
        {
            var idetInterface = dataAsm.GetType("Kingdee.BOS.Orm.Metadata.DataEntity.IDataEntityType", throwOnError: true)!;
            var serializerType = dataAsm.GetType("Kingdee.BOS.Serialization.DcxmlSerializer", throwOnError: true)!;
            var enumerableType = typeof(System.Collections.Generic.IEnumerable<>).MakeGenericType(idetInterface);
            var ctor = serializerType.GetConstructor(new[] { enumerableType })
                ?? throw new InvalidOperationException("DcxmlSerializer(IEnumerable<IDataEntityType>) ctor not found");
            return ctor.Invoke(new object[] { schemas });
        }

        /// <summary>
        /// Scans BOS.Core for every [DataEntityType]-decorated class under the
        /// Convert/BusinessFlow namespaces and reflectively builds an
        /// IDataEntityType for each. ListDcxmlBinder needs all polymorphic
        /// children registered (Policy subclasses, FieldMap variants, etc.) —
        /// the deserializer only consults the binder by element name.
        /// </summary>
        private static IList CollectConvertElementSchemas(Assembly dataAsm, Assembly coreAsm)
        {
            var dtClass = dataAsm.GetType("Kingdee.BOS.Orm.Metadata.DataEntity.CLR.DataEntityType", throwOnError: true)!;
            var getDt = dtClass.GetMethod("GetDataEntityType", BindingFlags.Public | BindingFlags.Static)!;
            var idetInterface = dataAsm.GetType("Kingdee.BOS.Orm.Metadata.DataEntity.IDataEntityType", throwOnError: true)!;
            var listType = typeof(System.Collections.Generic.List<>).MakeGenericType(idetInterface);
            var list = (IList)Activator.CreateInstance(listType)!;

            var skipped = 0;
            var byName = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (var t in SafeGetTypes(coreAsm))
            {
                if (!t.IsClass || t.IsAbstract || t.IsGenericTypeDefinition) continue;
                if (!t.IsSerializable) continue;
                object? schema;
                try { schema = getDt.Invoke(null, new object[] { t }); }
                catch { skipped++; continue; }
                if (schema == null) continue;
                var name = (string?)schema.GetType().GetProperty("Name")?.GetValue(schema);
                if (string.IsNullOrEmpty(name)) continue;
                // First-write-wins: BOS.Core has a few duplicate class names across namespaces;
                // ListDcxmlBinder builds a flat name→type dict so we can only register one.
                if (!byName.ContainsKey(name!)) byName[name!] = schema;
            }
            foreach (var schema in byName.Values) list.Add(schema);
            if (skipped > 0) Console.WriteLine($"schema_build_skipped: {skipped}");
            return list;
        }

        /// <summary>
        /// `Assembly.GetTypes()` throws ReflectionTypeLoadException if any type
        /// fails to load (e.g., a type referencing a missing dependency). Use
        /// the `Types` from the exception so we can still process the loadable
        /// ones — Kingdee assemblies have a few stragglers that fail on
        /// machines without all optional features installed.
        /// </summary>
        private static IEnumerable<Type> SafeGetTypes(Assembly asm)
        {
            try { return asm.GetTypes(); }
            catch (ReflectionTypeLoadException ex)
            {
                return ex.Types.Where(t => t != null)!;
            }
        }

        private static void ReportFirstDiff(string a, string b)
        {
            var n = Math.Min(a.Length, b.Length);
            for (var i = 0; i < n; i++)
            {
                if (a[i] != b[i])
                {
                    var lo = Math.Max(0, i - 30);
                    var hi = Math.Min(n, i + 30);
                    Console.WriteLine($"first_diff_at: char {i}");
                    Console.WriteLine($"  input  [{lo}..{hi}]: {Escape(a.Substring(lo, hi - lo))}");
                    Console.WriteLine($"  output [{lo}..{hi}]: {Escape(b.Substring(lo, hi - lo))}");
                    return;
                }
            }
            Console.WriteLine($"prefix matches up to {n} chars; lengths differ (input={a.Length} output={b.Length})");
            if (a.Length > b.Length)
                Console.WriteLine($"  input tail: {Escape(a.Substring(n, Math.Min(60, a.Length - n)))}");
            else
                Console.WriteLine($"  output tail: {Escape(b.Substring(n, Math.Min(60, b.Length - n)))}");
        }

        private static string Escape(string s) => s
            .Replace("\\", "\\\\")
            .Replace("\r", "\\r")
            .Replace("\n", "\\n")
            .Replace("\t", "\\t");
    }
}
