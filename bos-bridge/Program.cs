using System;
using System.IO;
using System.Reflection;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace OpenDeploy.BosBridge
{
    /// <summary>
    /// Entry point. By default runs an NDJSON request/response loop on
    /// stdin/stdout — Node spawns the bridge once, then sends each request
    /// as a single JSON line and reads back the response line. Stderr is
    /// reserved for diagnostic logs; never parsed by Node.
    ///
    /// CLI subcommands (for manual debugging without Node):
    ///   serve                                (default — NDJSON loop)
    ///   ping                                 (one-shot ping)
    ///   roundtrip &lt;input.xml&gt; [output.xml]   (one-shot normalize)
    ///   schema-probe                         (print BOS schema stats)
    /// </summary>
    internal static class Program
    {
        private static int Main(string[] args)
        {
            // Console defaults to the OS code page on Windows (GBK on zh-CN
            // installs), which mangles non-ASCII bytes in the JSON payloads
            // we exchange with Node. Force UTF-8 both ways.
            Console.InputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
            Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

            var resolver = DllResolver.Create();
            if (resolver.InstallPath == null)
            {
                LogStderr("install_path: <not found>");
                LogStderr("set BOS_BRIDGE_DESKCLIENT to the K3CloudClient directory");
                return 1;
            }
            resolver.Hook();

            BosContext ctx;
            try
            {
                ctx = BosContext.Initialize(resolver);
            }
            catch (Exception ex)
            {
                LogStderr($"initialize_failed: {Unwrap(ex).GetType().Name}: {Unwrap(ex).Message}");
                return 2;
            }
            LogStderr($"data_entity={ctx.DataEntityVersion} core={ctx.CoreVersion} schemas={ctx.RegisteredSchemas}");

            var cmd = args.Length > 0 ? args[0] : "serve";
            switch (cmd)
            {
                case "serve":
                    return RunServeLoop(ctx);
                case "ping":
                    Console.WriteLine("pong");
                    return 0;
                case "roundtrip":
                    if (args.Length < 2) { LogStderr("usage: roundtrip <input.xml> [output.xml]"); return 1; }
                    return RunRoundtripCli(ctx, args[1], args.Length >= 3 ? args[2] : null);
                case "schema-probe":
                    Console.WriteLine($"data_entity_version: {ctx.DataEntityVersion}");
                    Console.WriteLine($"bos_core_version: {ctx.CoreVersion}");
                    Console.WriteLine($"registered_schemas: {ctx.RegisteredSchemas}");
                    return 0;
                default:
                    LogStderr($"unknown command: {cmd}");
                    return 1;
            }
        }

        // ── NDJSON serve loop ──────────────────────────────────────────

        private static int RunServeLoop(BosContext ctx)
        {
            string? line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (line.Length == 0) continue;
                JToken? requestId = null;
                try
                {
                    var req = JObject.Parse(line);
                    requestId = req["id"];
                    var op = (string?)req["op"] ?? throw new InvalidOperationException("missing field: op");
                    var result = Dispatch(ctx, op, req);
                    EmitOk(requestId, result);
                }
                catch (Exception ex)
                {
                    EmitError(requestId, Unwrap(ex));
                }
            }
            return 0;
        }

        private static object Dispatch(BosContext ctx, string op, JObject req)
        {
            switch (op)
            {
                case "ping":
                    return "pong";
                case "normalize_convert_rule":
                    return new { xml = ctx.NormalizeConvertRule(RequireString(req, "xml")) };
                case "add_convert_field_map":
                {
                    var xml = RequireString(req, "xml");
                    var target = RequireString(req, "target_field_key");
                    var source = (string?)req["source_field_key"];
                    var mode = (string?)req["mode"] ?? "Auto";
                    var formula = (string?)req["formula"];
                    var entry = (string?)req["target_entry_key"];
                    return new { xml = ctx.AddConvertFieldMap(xml, target, source ?? string.Empty, mode, formula, entry) };
                }
                case "set_convert_group_by":
                {
                    var xml = RequireString(req, "xml");
                    var mode = RequireString(req, "mode");
                    var field1 = (string?)req["field1"];
                    var field2 = (string?)req["field2"];
                    var field3 = (string?)req["field3"];
                    var formula = (string?)req["formula"];
                    return new { xml = ctx.SetConvertGroupBy(xml, mode, field1, field2, field3, formula) };
                }
                default:
                    throw new InvalidOperationException($"unknown op: {op}");
            }
        }

        private static string RequireString(JObject req, string field) =>
            (string?)req[field] ?? throw new InvalidOperationException($"missing field: {field}");

        private static void EmitOk(JToken? id, object result)
        {
            var obj = new JObject { ["ok"] = true, ["result"] = JToken.FromObject(result) };
            if (id != null) obj["id"] = id;
            Console.WriteLine(obj.ToString(Formatting.None));
        }

        private static void EmitError(JToken? id, Exception ex)
        {
            var obj = new JObject
            {
                ["ok"] = false,
                ["code"] = ex.GetType().Name,
                ["message"] = ex.Message,
            };
            if (id != null) obj["id"] = id;
            Console.WriteLine(obj.ToString(Formatting.None));
        }

        // ── CLI roundtrip (debug) ──────────────────────────────────────

        private static int RunRoundtripCli(BosContext ctx, string inputPath, string? outputPath)
        {
            var inputXml = File.ReadAllText(inputPath, Encoding.UTF8);
            Console.WriteLine($"input_chars: {inputXml.Length}");
            string outputXml;
            try
            {
                outputXml = ctx.NormalizeConvertRule(inputXml);
            }
            catch (Exception ex)
            {
                LogStderr($"normalize_failed: {Unwrap(ex).GetType().Name}: {Unwrap(ex).Message}");
                return 3;
            }
            Console.WriteLine($"output_chars: {outputXml.Length}");
            if (outputPath != null)
            {
                File.WriteAllText(outputPath, outputXml, new UTF8Encoding(false));
                Console.WriteLine($"output_path: {outputPath}");
            }
            return inputXml == outputXml ? 0 : 4;
        }

        // ── helpers ────────────────────────────────────────────────────

        private static Exception Unwrap(Exception ex) =>
            ex is TargetInvocationException tie && tie.InnerException != null ? tie.InnerException : ex;

        private static void LogStderr(string msg)
        {
            Console.Error.WriteLine($"[bos-bridge] {msg}");
            Console.Error.Flush();
        }
    }
}
