using System;
using System.Collections;
using System.Collections.Generic;
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
    }
}
