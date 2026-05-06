using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace OpenDeploy.BosBridge
{
    // ── Operations + Toolbar Buttons (Plan 5.12.6 Task 2.1) ────────────
    //
    // Read-only walk over a FormMetadata DCXML. Deserializes via the shared
    // DcxmlSerializer (the same serializer that handles ConvertRuleMetaData
    // and BusinessInfo-shaped patches) and enumerates two collections:
    //
    //   1. BusinessInfo.GetForm().FormOperations — custom FormOperation
    //      nodes (e.g. TESTCopy / OperationId=2 复制 variant; or TestPyOp /
    //      OperationId=45 自定义 with inline ServicePlugins/PyScript).
    //   2. LayoutInfos[*].Appearances[*].Menu.BarDataManager.BarItems —
    //      BarButtonItem nodes, optionally bound to an operation via
    //      ClickActions/FormBusinessService.Parameters=["<opKey>"] +
    //      ActionId=23 (CallFormOperation per business rule wire enum).
    //
    // Reflection-only: the bridge csproj references Kingdee.BOS.Core /
    // Kingdee.BOS.DataEntity / Kingdee.BOS.Orm but not the deeper FormElement
    // / BarElement namespaces, so we resolve property names by string. Wire
    // shape verified by capture req-96 (docs/recon/2026-05-06-operations-spike.md).

    internal sealed partial class BosContext
    {
        /// <summary>
        /// Walk the FormMetadata's BusinessInfo + LayoutInfos and emit a typed
        /// summary of every Form.FormOperations entry plus every BarButtonItem
        /// across all FormAppearance / EntryEntityAppearance menus. Pure read —
        /// does not re-serialize the input. Used by the agent's
        /// `k3cloud_list_form_operations_and_buttons` tool to inspect what
        /// custom operations + toolbar buttons already exist before deciding
        /// whether to add or remove.
        /// </summary>
        public ListOperationsResult ListOperations(string xml)
        {
            if (string.IsNullOrEmpty(xml)) throw new ArgumentException("xml is empty", nameof(xml));
            var formMeta = _serializer.DeserializeFromString(xml)
                ?? throw new InvalidOperationException("DeserializeFromString returned null");

            var operations = new List<OperationSummary>();
            var buttons = new List<ToolbarButtonSummary>();

            // ── Form.FormOperations ──────────────────────────────────────
            // BusinessInfo.GetForm() walks Elements for the first Form-typed
            // node; reflecting on it sidesteps the compile-time dep on
            // Kingdee.BOS.Core.Metadata.FormElement.Form. After Plan 5.12.3a
            // we know DcxmlSerializer leaves Elements in BusinessInfo.Elements
            // (pre-EndInit shape), so reach for Form via the public iterator.
            var businessInfo = formMeta.GetType().GetProperty("BusinessInfo")?.GetValue(formMeta);
            if (businessInfo != null)
            {
                var form = FindFormElement(businessInfo);
                if (form != null)
                {
                    var formOpsRaw = form.GetType().GetProperty("FormOperations")?.GetValue(form);
                    if (formOpsRaw is IEnumerable formOps)
                    {
                        foreach (var op in formOps)
                        {
                            if (op == null) continue;
                            operations.Add(BuildOperationSummary(op));
                        }
                    }
                }
            }

            // ── LayoutInfos → Appearances → Menu → BarItems ──────────────
            // Per FormMetadata decompile (line 46): LayoutInfos is List<LayoutInfo>.
            // Per FormMetadata.GetMenu() (line 269+), FormAppearance.Menu and
            // EntryEntityAppearance.Menu both return BarDataManager. Toolbar
            // buttons live in BarDataManager.BarItems with type BarButtonItem.
            var layoutInfos = formMeta.GetType().GetProperty("LayoutInfos")?.GetValue(formMeta) as IEnumerable;
            if (layoutInfos != null)
            {
                foreach (var layoutInfo in layoutInfos)
                {
                    if (layoutInfo == null) continue;
                    var appearances = layoutInfo.GetType().GetProperty("Appearances")?.GetValue(layoutInfo) as IEnumerable;
                    if (appearances == null) continue;
                    foreach (var ap in appearances)
                    {
                        if (ap == null) continue;
                        // EntryEntityAppearance has its own Key (entry entity
                        // key). FormAppearance is the form-level toolbar — Key
                        // here is the appearance's own key, not an entity
                        // reference, so we only surface parentEntityKey for
                        // entry-level menus.
                        var apTypeName = ap.GetType().Name;
                        var parentEntityKey = apTypeName == "EntryEntityAppearance"
                            ? ReadStringProperty(ap, "Key")
                            : null;

                        AppendButtonsFromMenu(ap, "Menu", parentEntityKey, buttons);
                        // EntryEntityAppearance also has ContextMenu / FloatMenu;
                        // FormAppearance has ListMenu. v0.1 only surfaces the
                        // primary "Menu" toolbar — context/float/list menus are
                        // future-scope (5.12.6 Task spec is the regular toolbar).
                    }
                }
            }

            return new ListOperationsResult
            {
                Operations = operations,
                ToolbarButtons = buttons,
            };
        }

        private static OperationSummary BuildOperationSummary(object op)
        {
            var summary = new OperationSummary
            {
                OperationKey = ReadStringProperty(op, "Operation") ?? string.Empty,
                OperationId = ReadLongProperty(op, "OperationId"),
                OperationName = ReadLocaleValueText(op, "OperationName"),
                ExpressValue = ExtractFirstExpressValue(op),
                OperEleIds = ReadStringProperty(op, "OperEleIds"),
                ServicePlugins = BuildServicePluginSummaries(op),
            };
            return summary;
        }

        /// <summary>
        /// Pull <c>FormOperation.Parmeter.OperationParameters[0].ExpressValue</c>
        /// when present. Wire shape per req-96 (`IsCopyLinkEntry:0`) /
        /// req-212 (`IsShowMes:0;IsForbidWFService:0`) — semicolon-delimited
        /// `key:value` strings. Spike doc §3.2 / §3.3.
        /// </summary>
        private static string? ExtractFirstExpressValue(object op)
        {
            // Note the typo: BOS Core property is `Parmeter` not `Parameter`
            // (see properties/FormOperation.cs:338). The wire <Parmeter> tag
            // in capture req-96 confirms this is intentional in BOS source.
            var parmeter = op.GetType().GetProperty("Parmeter")?.GetValue(op);
            if (parmeter == null) return null;
            // OperationParameter has both a single-value form and a list form
            // depending on subtype; try a `OperationParameters` collection
            // first then fall back to a direct `ExpressValue`.
            if (parmeter.GetType().GetProperty("OperationParameters")?.GetValue(parmeter) is IEnumerable paramList)
            {
                foreach (var p in paramList)
                {
                    if (p == null) continue;
                    var ev = ReadStringProperty(p, "ExpressValue");
                    if (!string.IsNullOrEmpty(ev)) return ev;
                }
            }
            // Single-OperationParameter fallback — the deserializer flattens
            // a single child element when the schema supports both shapes.
            return ReadStringProperty(parmeter, "ExpressValue");
        }

        private static List<ServicePluginSummary> BuildServicePluginSummaries(object op)
        {
            var sink = new List<ServicePluginSummary>();
            if (!(op.GetType().GetProperty("ServicePlugins")?.GetValue(op) is IEnumerable plugins)) return sink;
            foreach (var plug in plugins)
            {
                if (plug == null) continue;
                sink.Add(new ServicePluginSummary
                {
                    ClassName = ReadStringProperty(plug, "ClassName") ?? string.Empty,
                    PlugInType = ReadIntProperty(plug, "PlugInType"),
                    HasPyScript = !string.IsNullOrEmpty(ReadScriptString(plug, "PyScript")),
                });
            }
            return sink;
        }

        /// <summary>
        /// PlugIn.PyScript is typed Kingdee.BOS.Orm.DataEntity.ScriptString
        /// (a thin wrapper around string). Avoid the compile-time dep — read
        /// the raw object and stringify; null collapses to empty string.
        /// </summary>
        private static string? ReadScriptString(object obj, string name)
        {
            var prop = obj.GetType().GetProperty(name);
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

        private static void AppendButtonsFromMenu(
            object appearance,
            string menuPropName,
            string? parentEntityKey,
            List<ToolbarButtonSummary> sink)
        {
            var menu = appearance.GetType().GetProperty(menuPropName)?.GetValue(appearance);
            if (menu == null) return;
            var bdm = menu.GetType().GetProperty("BarDataManager")?.GetValue(menu);
            // Some menu types ARE the BarDataManager directly; FormAppearance.Menu
            // wraps a Menu object that holds BarDataManager. Walk both shapes.
            if (bdm == null) bdm = menu;
            var barItemsRaw = bdm.GetType().GetProperty("BarItems")?.GetValue(bdm);
            var barItemLinksRaw = bdm.GetType().GetProperty("BarItemLinks")?.GetValue(bdm);
            if (!(barItemsRaw is IEnumerable barItems)) return;

            // Pre-index BarItemLinks by BarItemKey so each BarButtonItem can
            // look up its link Id + (if present) parent toolbar key. Per
            // capture req-96, BarItemLink has Id + BarItemKey (no nested
            // toolbar key on this wire shape; future toolbar grouping would
            // surface as a parent-link relationship).
            var linksByKey = new Dictionary<string, object>(StringComparer.Ordinal);
            if (barItemLinksRaw is IEnumerable barLinks)
            {
                foreach (var link in barLinks)
                {
                    if (link == null) continue;
                    var bik = ReadStringProperty(link, "BarItemKey");
                    if (!string.IsNullOrEmpty(bik) && !linksByKey.ContainsKey(bik!))
                        linksByKey[bik!] = link;
                }
            }

            foreach (var item in barItems)
            {
                if (item == null) continue;
                // BarItem has subclasses (BarButtonItem, BarSubItem,
                // BarStaticItem, …). v0.1 only surfaces BarButtonItem — the
                // user-facing "toolbar button" concept the LLM tools target.
                if (item.GetType().Name != "BarButtonItem") continue;

                var key = ReadStringProperty(item, "Key") ?? string.Empty;
                var btn = new ToolbarButtonSummary
                {
                    ButtonKey = key,
                    ButtonId = ReadStringProperty(item, "Id"),
                    Caption = ReadLocaleValueText(item, "Caption"),
                    Description = ReadLocaleValueText(item, "Description"),
                    Seq = ReadIntProperty(item, "Seq"),
                    ParentEntityKey = parentEntityKey,
                    BoundOperationKey = ExtractBoundOperationKey(item),
                };
                if (linksByKey.TryGetValue(key, out var link))
                {
                    btn.BarItemLinkId = ReadStringProperty(link, "Id");
                }
                sink.Add(btn);
            }
        }

        /// <summary>
        /// Extract the operation key the button calls when clicked. Per recon
        /// §4.4 + capture req-96: BarButtonItem.ClickActions[0] is a
        /// FormBusinessService whose Parameters property holds a JSON-array
        /// string like <c>["TESTCopy"]</c>; ActionId=23 indicates "调用表单操作".
        /// Returns null when the button is an "orphan shell" (req-117 case —
        /// BOS Designer auto-strips ClickActions when the bound operation is
        /// gone, so the button still ships but has no bound op).
        /// </summary>
        private static string? ExtractBoundOperationKey(object barItem)
        {
            var clickActions = barItem.GetType().GetProperty("ClickActions")?.GetValue(barItem) as IEnumerable;
            if (clickActions == null) return null;
            foreach (var svc in clickActions)
            {
                if (svc == null) continue;
                var paramsString = ReadStringProperty(svc, "Parameters");
                if (string.IsNullOrEmpty(paramsString)) continue;
                try
                {
                    // FormBusinessService.Parameters is a string holding a
                    // JSON array; the Parameters property accessor (line 101
                    // of FormBusinessService.cs) re-encodes from a JSONArray.
                    // Newtonsoft is already a bridge dep so JArray.Parse is
                    // free. The non-null guard above (`IsNullOrEmpty`) keeps
                    // the nullable-aware compiler happy on net48.
                    var arr = JArray.Parse(paramsString!);
                    if (arr.Count > 0)
                    {
                        var v = (string?)arr[0];
                        if (!string.IsNullOrEmpty(v)) return v;
                    }
                }
                catch
                {
                    // Malformed Parameters string — skip this action and try
                    // the next one. Don't throw; list ops are read-only and
                    // surfacing whatever is parseable beats crashing on a
                    // single malformed click action.
                }
            }
            return null;
        }

        /// <summary>
        /// Locate the Form-typed element in BusinessInfo. Per FormMetadata
        /// decompile (line 85), <c>BusinessInfo.GetForm()</c> walks the
        /// Elements list; we replicate the lookup-by-runtime-type-name to
        /// avoid taking a compile-time dep on
        /// Kingdee.BOS.Core.Metadata.FormElement.Form. The first element
        /// whose runtime type is named "Form" wins — there's exactly one
        /// per FormMetadata in practice.
        /// </summary>
        private static object? FindFormElement(object businessInfo)
        {
            // Try direct GetForm() method first (cleaner than walking).
            var getForm = businessInfo.GetType().GetMethod("GetForm", Type.EmptyTypes);
            if (getForm != null)
            {
                try
                {
                    var form = getForm.Invoke(businessInfo, null);
                    if (form != null) return form;
                }
                catch
                {
                    // Fall through to enumerate-based lookup.
                }
            }
            // Walk Elements + Entrys for a Form-shaped element. Mirror
            // EnumerateBusinessElements in BusinessRules.cs.
            var elements = businessInfo.GetType().GetProperty("Elements")?.GetValue(businessInfo) as IEnumerable;
            if (elements != null)
            {
                foreach (var e in elements)
                {
                    if (e == null) continue;
                    if (e.GetType().Name == "Form") return e;
                }
            }
            return null;
        }

        /// <summary>
        /// Append a custom <c>FormOperation</c> to <c>Form.FormOperations</c>.
        /// Defaults <c>OperationId</c> to 45 (DoNothing / 自定义) per recon
        /// §3.3 — agents can override for variants like OperationId=2 (复制
        /// with a custom Parmeter). When <paramref name="args.PluginClassName"/>
        /// is non-empty, a <c>ServicePlugins/PlugIn</c> entry is appended with
        /// <c>PlugInType=1</c> (Python wire convention) and <c>PyScript</c>
        /// inline as a <see cref="ScriptString"/>-typed property — coerced via
        /// <see cref="ConvertValue"/>'s single-string-arg ctor path. Returns
        /// the re-serialized DCXML.
        ///
        /// Wire shape verified by capture req-212 (`docs/recon/2026-05-06-operations-spike.md` §3.4):
        ///   <c>&lt;ServicePlugins&gt;&lt;PlugIn ElementType="0" ElementStyle="0"&gt;
        ///     &lt;ClassName&gt;...&lt;/ClassName&gt;
        ///     &lt;PlugInType&gt;1&lt;/PlugInType&gt;
        ///     &lt;PyScript&gt;&lt;![CDATA[...]]&gt;&lt;/PyScript&gt;
        ///   &lt;/PlugIn&gt;&lt;/ServicePlugins&gt;</c>
        /// </summary>
        public string AddCustomOperation(AddCustomOperationArgs args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            if (string.IsNullOrEmpty(args.Xml)) throw new ArgumentException("xml is empty", "xml");
            // Reject empty operationKey explicitly — Form.FormOperations is
            // keyed by Operation, and BOS Designer surfaces "操作标识不能为空"
            // when the user tries to save with a blank key. Match that contract.
            if (string.IsNullOrWhiteSpace(args.OperationKey))
                throw new ArgumentException("operationKey: cannot be empty", "operationKey");
            if (string.IsNullOrEmpty(args.OperationName))
                throw new ArgumentException("operationName: cannot be empty", "operationName");
            if (string.IsNullOrEmpty(args.OperationParameterId))
                throw new ArgumentException("operationParameterId: cannot be empty", "operationParameterId");

            var formMeta = _serializer.DeserializeFromString(args.Xml)
                ?? throw new InvalidOperationException("DeserializeFromString returned null");

            var businessInfo = formMeta.GetType().GetProperty("BusinessInfo")?.GetValue(formMeta)
                ?? throw new InvalidOperationException(
                    $"input deserialized to {formMeta.GetType().FullName} which has no BusinessInfo");

            var form = FindFormElement(businessInfo)
                ?? throw new InvalidOperationException("Form element not found in BusinessInfo");

            // Form.FormOperations is `List<FormOperation>` (decompiled at
            // bos-core-full.cs:177854). DcxmlSerializer ctors leave it
            // null when the source XML has no <FormOperations> block; the
            // get-or-create path below covers both shapes.
            var formOpsList = GetOrCreateFormOperations(form);

            // Duplicate-key guard — first match wins. Matches BOS Designer's
            // own "操作标识已存在" save-time validation; the wire would happily
            // accept duplicates and the runtime would silently dispatch to
            // the first one, so we reject up-front for clarity.
            foreach (var existing in formOpsList)
            {
                if (existing == null) continue;
                if (string.Equals(ReadStringProperty(existing, "Operation"), args.OperationKey, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException($"操作 {args.OperationKey} 已存在");
                }
            }

            var formOpType = ResolveType("Kingdee.BOS.Core.Metadata.FormElement.FormOperation")
                ?? throw new InvalidOperationException(
                    "Kingdee.BOS.Core.Metadata.FormElement.FormOperation not found in BOS Core");
            var op = Activator.CreateInstance(formOpType)!;

            // Id == Operation per FormOperation getter (FormOperation.cs:299-313)
            // — id falls back to Operation when blank, but Designer ships them
            // identical so we set both explicitly to avoid the get-side fallback
            // surprising future readers.
            SetProp(op, "Id", args.OperationKey);
            SetProp(op, "Operation", args.OperationKey);
            // OperationId is `long`. Default 45 (DoNothing) per recon §3.3 +
            // capture req-212; spec §6.1 lets agents override (e.g. 2 for 复制
            // variants per req-96). ConvertValue coerces int/JValue→long.
            SetProp(op, "OperationId", args.OperationId ?? 45L);
            // OperationName is `LocaleValue` (FormOperation.cs:335). ConvertValue
            // wraps the string via LocaleValue's single-string-arg ctor — same
            // path that 5.12.3b's add_entity_service_rule uses for Description /
            // PreConditionDesc. Wire ships inline `<OperationName>测试</OperationName>`
            // (req-212 confirms — no <LocaleValue> wrapper element).
            SetProp(op, "OperationName", args.OperationName);
            // LoadKeys is a string-typed wrapper around ReLoadKeys (List<string>);
            // wire ships `<LoadKeys>[]</LoadKeys>` per recon §3.2 row 10. Setting
            // the property serializes the empty list back as `[]` via
            // KDObjectConverter (FormOperation.cs:380-389).
            SetProp(op, "LoadKeys", "[]");

            // FormOperation.Parmeter is typed `OperationParameter` (single,
            // not collection) — see FormOperation.cs:338. Wire wraps it as
            // `<Parmeter><OperationParameter>...</OperationParameter></Parmeter>`
            // because DcxmlSerializer renders a complex property as
            // <PropertyName><RuntimeTypeName>...</RuntimeTypeName></PropertyName>.
            // Note the typo: BOS source uses `Parmeter`, not `Parameter`
            // (recon §3.2 + 4 wire occurrences).
            var paramType = ResolveType("Kingdee.BOS.Core.Metadata.FormElement.OperationParameter")
                ?? throw new InvalidOperationException(
                    "Kingdee.BOS.Core.Metadata.FormElement.OperationParameter not found in BOS Core");
            var parameter = Activator.CreateInstance(paramType)!;
            SetProp(parameter, "Id", args.OperationParameterId);
            if (!string.IsNullOrEmpty(args.OperationObjectKey))
                SetProp(parameter, "OperationObjectKey", args.OperationObjectKey);
            if (!string.IsNullOrEmpty(args.ExpressValue))
                SetProp(parameter, "ExpressValue", args.ExpressValue);
            SetProp(op, "Parmeter", parameter);

            // ── ServicePlugins (optional, only when pluginClassName is given) ─
            // Per spec: pyBody can be empty (agent might just register a
            // ClassName placeholder) — only fill PyScript when non-empty.
            if (!string.IsNullOrEmpty(args.PluginClassName))
            {
                var pluginsList = GetOrCreateServicePlugins(op);
                var plugInType = ResolveType("Kingdee.BOS.Core.Metadata.FormElement.PlugIn")
                    ?? throw new InvalidOperationException(
                        "Kingdee.BOS.Core.Metadata.FormElement.PlugIn not found in BOS Core");
                var plugin = Activator.CreateInstance(plugInType)!;
                SetProp(plugin, "ClassName", args.PluginClassName);
                // PlugInType is typed `short` on PlugIn (bos-core-full.cs:291915).
                // Wire convention (per recon §3.4 + existing convert-plugin code
                // in BosContext.cs:223): 1=Python, 0=DLL. ConvertValue coerces
                // int→short via Convert.ChangeType.
                SetProp(plugin, "PlugInType", 1);
                if (!string.IsNullOrEmpty(args.PyBody))
                {
                    // PyScript is typed Kingdee.BOS.Orm.DataEntity.ScriptString
                    // (a wrapper around string). ConvertValue's single-string-
                    // arg-ctor path handles the string→ScriptString coercion —
                    // ScriptString has `ScriptString(string)` available.
                    SetProp(plugin, "PyScript", args.PyBody);
                }
                pluginsList.Add(plugin);
            }

            formOpsList.Add(op);
            return _serializer.SerializeToString(formMeta, null);
        }

        /// <summary>
        /// Pull (or, defensively, create) the Form's FormOperations collection.
        /// FormMetadata DCXML deserialization can leave this null when the
        /// source XML has no <c>&lt;FormOperations&gt;</c> block (the
        /// operations-no-ops baseline is the canonical example).
        /// </summary>
        private static IList GetOrCreateFormOperations(object form)
        {
            var prop = form.GetType().GetProperty("FormOperations", BindingFlags.Public | BindingFlags.Instance)
                ?? throw new InvalidOperationException(
                    $"{form.GetType().FullName} has no FormOperations property");
            var list = prop.GetValue(form) as IList;
            if (list != null) return list;
            list = (IList)Activator.CreateInstance(prop.PropertyType)!;
            prop.SetValue(form, list);
            return list;
        }

        /// <summary>
        /// Pull (or create) the FormOperation's ServicePlugins collection.
        /// FormOperation's ctor (FormOperation.cs:412) pre-initializes
        /// <c>ServicePlugins = new List&lt;PlugIn&gt;()</c>, so the
        /// create-and-set-back path is a defensive fallback for unfamiliar
        /// FormOperation subclasses.
        /// </summary>
        private static IList GetOrCreateServicePlugins(object formOperation)
        {
            var prop = formOperation.GetType().GetProperty("ServicePlugins", BindingFlags.Public | BindingFlags.Instance)
                ?? throw new InvalidOperationException(
                    $"{formOperation.GetType().FullName} has no ServicePlugins property");
            var list = prop.GetValue(formOperation) as IList;
            if (list != null) return list;
            list = (IList)Activator.CreateInstance(prop.PropertyType)!;
            prop.SetValue(formOperation, list);
            return list;
        }

        // ── Result DTOs ────────────────────────────────────────────────
        // JsonProperty annotations force camelCase wire names — JToken.FromObject
        // otherwise uses C# property casing (PascalCase) which mismatches the
        // TypeScript callers in src/main/erp/k3cloud/bridge.

        public sealed class ListOperationsResult
        {
            [JsonProperty("operations")]
            public List<OperationSummary> Operations { get; set; } = new List<OperationSummary>();

            [JsonProperty("toolbarButtons")]
            public List<ToolbarButtonSummary> ToolbarButtons { get; set; } = new List<ToolbarButtonSummary>();
        }

        public sealed class OperationSummary
        {
            [JsonProperty("operationKey")]
            public string OperationKey { get; set; } = string.Empty;

            [JsonProperty("operationId")]
            public long OperationId { get; set; }

            [JsonProperty("operationName")]
            public string? OperationName { get; set; }

            [JsonProperty("expressValue")]
            public string? ExpressValue { get; set; }

            [JsonProperty("operEleIds")]
            public string? OperEleIds { get; set; }

            [JsonProperty("servicePlugins")]
            public List<ServicePluginSummary> ServicePlugins { get; set; } = new List<ServicePluginSummary>();
        }

        public sealed class ServicePluginSummary
        {
            [JsonProperty("className")]
            public string ClassName { get; set; } = string.Empty;

            // 0 = DLL, 1 = Python — matches BOS plugin convention used
            // throughout 5.12.3b / 5.12.4 / 5.12.6 wire (req-212 confirms
            // PlugInType=1 for inline IronPython).
            [JsonProperty("plugInType")]
            public int PlugInType { get; set; }

            [JsonProperty("hasPyScript")]
            public bool HasPyScript { get; set; }
        }

        public sealed class ToolbarButtonSummary
        {
            [JsonProperty("buttonKey")]
            public string ButtonKey { get; set; } = string.Empty;

            [JsonProperty("buttonId")]
            public string? ButtonId { get; set; }

            [JsonProperty("caption")]
            public string? Caption { get; set; }

            [JsonProperty("description")]
            public string? Description { get; set; }

            [JsonProperty("seq")]
            public int Seq { get; set; }

            // null = button lives on a FormAppearance (form-level toolbar);
            // non-null = button lives on an EntryEntityAppearance for the
            // named entity (entry-level toolbar). v0.1 supports both shapes
            // per recon §6.4.
            [JsonProperty("parentEntityKey")]
            public string? ParentEntityKey { get; set; }

            // null = "orphan shell" (BOS Designer stripped ClickActions
            // because the bound operation was deleted — see recon §4.5);
            // non-null = the FormOperation.Operation key this button calls
            // via ActionId=23 / FormBusinessService.Parameters=["<key>"].
            [JsonProperty("boundOperationKey")]
            public string? BoundOperationKey { get; set; }

            [JsonProperty("barItemLinkId")]
            public string? BarItemLinkId { get; set; }
        }

        // ── add-op args DTO (deserialized from Program.cs Dispatch) ───────
        // Newtonsoft honors [JsonProperty] camelCase mapping so wire keys
        // (operationKey, pluginClassName, …) bind cleanly via req.ToObject<>.

        internal sealed class AddCustomOperationArgs
        {
            [JsonProperty("xml")]
            public string Xml { get; set; } = string.Empty;

            [JsonProperty("operationKey")]
            public string OperationKey { get; set; } = string.Empty;

            [JsonProperty("operationName")]
            public string OperationName { get; set; } = string.Empty;

            // Caller-provided GUID for the OperationParameter.Id child; surfaced
            // as a required arg so agents control identity (idempotent re-runs
            // can reuse the same GUID for byte-stable diffs).
            [JsonProperty("operationParameterId")]
            public string OperationParameterId { get; set; } = string.Empty;

            // Default 45 (DoNothing / 自定义) when omitted — recon §3.3 +
            // capture req-212. Long instead of int because BOS schema is `long`.
            [JsonProperty("operationId")]
            public long? OperationId { get; set; }

            // Optional — entry-key context for entry-level operations like
            // 复制 (e.g. "FEntity"); null/empty for header-level ops.
            [JsonProperty("operationObjectKey")]
            public string? OperationObjectKey { get; set; }

            // Optional — semicolon-delimited `key:value` pairs (req-96 example
            // `IsCopyLinkEntry:0`, req-212 example `IsShowMes:0;IsForbidWFService:0`).
            [JsonProperty("expressValue")]
            public string? ExpressValue { get; set; }

            // Optional ServicePlugins entry — only emitted when non-empty.
            [JsonProperty("pluginClassName")]
            public string? PluginClassName { get; set; }

            // Optional inline IronPython source. When omitted but
            // PluginClassName is set, the PlugIn ships without <PyScript>
            // (BOS Designer also accepts this — class-name-only plugin shell).
            [JsonProperty("pyBody")]
            public string? PyBody { get; set; }
        }
    }
}
