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
                    // BarItemLink.ParentKey is the toolbar key the link
                    // attaches to (defaults to "ToolBar" per BarItemLink ctor
                    // at bos-core-full.cs:253045). Surface it so callers can
                    // distinguish "uses default ToolBar" from "uses custom
                    // UNW_ToolBar"; null when the property is unreadable.
                    btn.ToolbarKey = ReadStringProperty(link, "ParentKey");
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
        /// Get-or-create the Form element. Newly created extensions ship a
        /// minimal baseline-diff FKERNELXML with no Form overlay (the Form
        /// node is only emitted once the extension actually adds elements
        /// inside Form's collections). The first time bridge writes a
        /// FormOperation / BarButtonItem, we synthesize the Form overlay
        /// using the extension's own form id (the "ext.id" the connector
        /// passes via <paramref name="extensionFormId"/>). DcxmlSerializer
        /// emits Action="edit" + Oid="BOS_BillModel" + Id=&lt;ext-form-id&gt;
        /// on serialize, matching the wire shape register_python_plugins
        /// uses for its first-write path (verified by capture req-96 +
        /// the live req-212 baseline).
        /// </summary>
        private object EnsureFormElement(object businessInfo, string? extensionFormId)
        {
            var existing = FindFormElement(businessInfo);
            if (existing != null) return existing;
            if (string.IsNullOrEmpty(extensionFormId))
            {
                throw new InvalidOperationException(
                    "Form element not found in BusinessInfo, and no extensionFormId supplied to synthesize one. "
                  + "This is typical of a freshly-created extension that hasn't had any element written yet — "
                  + "pass extensionFormId (the ext FID, dashed or compact GUID) so bridge can synthesize the Form overlay.");
            }
            var formType = ResolveType("Kingdee.BOS.Core.Metadata.FormElement.Form");
            var form = Activator.CreateInstance(formType)
                ?? throw new InvalidOperationException("Failed to instantiate Form via reflection");
            // Action="edit" tells DcxmlSerializer this is a baseline overlay
            // (vs adding a brand-new Form). Oid="BOS_BillModel" matches the
            // BillModel root parent every business-info form descends from.
            SetProp(form, "Action", "edit");
            SetProp(form, "Oid", "BOS_BillModel");
            // Form.Id is Guid; coerce dashed-or-compact string into Guid.
            SetProp(form, "Id", new Guid(extensionFormId));
            // Append to BusinessInfo.Elements (IList<BusinessInfoElement>).
            var elements = businessInfo.GetType().GetProperty("Elements")?.GetValue(businessInfo) as IList
                ?? throw new InvalidOperationException("BusinessInfo.Elements is not an IList — cannot append synthesized Form");
            elements.Add(form);
            return form;
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

            // Get-or-create — freshly-created extensions have no Form overlay
            // until the first element is written (this is that first element).
            var form = EnsureFormElement(businessInfo, args.ExtensionFormId);

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
        /// Remove a <c>FormOperation</c> from <c>Form.FormOperations</c> by its
        /// <c>Operation</c> key. The wire is declarative (recon §2): once the
        /// node is gone from the strongly-typed model, <see cref="DcxmlSerializer.SerializeToString"/>
        /// simply does not emit a child for it — there is no <c>action="remove"</c>
        /// marker on the FormOperation itself. Throws
        /// <see cref="InvalidOperationException"/> with a Chinese "不存在" message
        /// when no match is found, matching the symmetry with
        /// <see cref="AddCustomOperation"/>'s "已存在" duplicate guard so the
        /// agent-facing tool surfaces consistent error wording. Returns the
        /// re-serialized DCXML.
        /// </summary>
        public string RemoveOperation(string xml, string operationKey)
        {
            if (string.IsNullOrEmpty(xml)) throw new ArgumentException("xml is empty", nameof(xml));
            if (string.IsNullOrEmpty(operationKey))
                throw new ArgumentException("operationKey is empty", nameof(operationKey));

            var formMeta = _serializer.DeserializeFromString(xml)
                ?? throw new InvalidOperationException("DeserializeFromString returned null");

            var businessInfo = formMeta.GetType().GetProperty("BusinessInfo")?.GetValue(formMeta)
                ?? throw new InvalidOperationException(
                    $"input deserialized to {formMeta.GetType().FullName} which has no BusinessInfo");

            var form = FindFormElement(businessInfo)
                ?? throw new InvalidOperationException("Form element not found in BusinessInfo");

            // Reach for the existing collection rather than GetOrCreate — when
            // FormOperations is null the input XML had no <FormOperations>
            // block, which means the requested key cannot exist. Surface the
            // same not-found error rather than allocating an empty list and
            // falling through (avoids confusing the caller with an "操作 X 不存在"
            // when the underlying issue is "this form has no operations at all").
            var formOpsRaw = form.GetType()
                .GetProperty("FormOperations", BindingFlags.Public | BindingFlags.Instance)
                ?.GetValue(form);
            if (!(formOpsRaw is IList formOpsList) || formOpsList.Count == 0)
                throw new InvalidOperationException($"操作 {operationKey} 不存在");

            // First-match wins. AddCustomOperation's duplicate guard ensures
            // there's only ever one FormOperation per key — but iterating then
            // calling IList.Remove(target) outside the foreach is the safe
            // pattern even if the collection is BindingList<FormOperation> or
            // a raw List<FormOperation>: foreach + collection-mutation throws
            // InvalidOperationException on enumeration invalidation.
            object? target = null;
            foreach (var op in formOpsList)
            {
                if (op == null) continue;
                if (string.Equals(ReadStringProperty(op, "Operation"), operationKey, StringComparison.Ordinal))
                {
                    target = op;
                    break;
                }
            }
            if (target == null)
                throw new InvalidOperationException($"操作 {operationKey} 不存在");

            formOpsList.Remove(target);
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

        /// <summary>
        /// Append a <c>BarButtonItem</c> to the target Appearance's
        /// <c>Menu.BarItems</c> + <c>Menu.BarItemLinks</c>, with
        /// <c>ClickActions/FormBusinessService</c> bound to an existing
        /// <c>Form.FormOperations</c> entry via <c>ActionId=23</c> (调用表单操作)
        /// + <c>Parameters="[\"<opKey>\"]"</c>. Wire shape verified by capture
        /// req-96 (`docs/recon/2026-05-06-operations-spike.md` §4):
        /// <code>
        ///   &lt;BarButtonItem ElementType="2005" ElementStyle="1"&gt;
        ///     &lt;ImageKey /&gt;&lt;Shortcut /&gt;&lt;Seq&gt;...&lt;/Seq&gt;
        ///     &lt;Description&gt;按钮&lt;/Description&gt;
        ///     &lt;IsShowTitle&gt;True&lt;/IsShowTitle&gt;
        ///     &lt;ClickActions&gt;&lt;FormBusinessService&gt;...
        ///       &lt;Parameters&gt;["TESTCopy"]&lt;/Parameters&gt;
        ///       &lt;ActionId&gt;23&lt;/ActionId&gt;...
        ///     &lt;/FormBusinessService&gt;&lt;/ClickActions&gt;
        ///     &lt;Caption&gt;按钮&lt;/Caption&gt;
        ///     &lt;Id&gt;...&lt;/Id&gt;&lt;Key&gt;UNW_tbButton&lt;/Key&gt;
        ///   &lt;/BarButtonItem&gt;
        ///   &lt;BarItemLink&gt;&lt;Id&gt;...&lt;/Id&gt;
        ///     &lt;BarItemKey&gt;UNW_tbButton&lt;/BarItemKey&gt;
        ///     &lt;ParentKey&gt;UNW_ToolBar&lt;/ParentKey&gt;
        ///   &lt;/BarItemLink&gt;
        /// </code>
        /// Pre-flight checks: (1) <paramref name="args.BoundOperationKey"/>
        /// must already exist in <c>Form.FormOperations</c> (matches BOS
        /// Designer's "操作不存在" save validation); (2)
        /// <paramref name="args.ButtonKey"/> must be unique across ALL
        /// Appearances' BarItems collections (BOS keys must be globally
        /// unique within a form). v0.1 does not auto-create the toolbar (the
        /// agent's tool docs require the user to seed it via BOS Designer
        /// first); we just stamp <c>BarItemLink.ParentKey</c> with the
        /// caller-supplied <paramref name="args.ToolbarKey"/>.
        /// </summary>
        public string AddToolbarButton(AddToolbarButtonArgs args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));
            if (string.IsNullOrEmpty(args.Xml)) throw new ArgumentException("xml is empty", "xml");
            if (args.Target == null) throw new ArgumentException("target is required", "target");
            if (string.IsNullOrEmpty(args.Target.Kind))
                throw new ArgumentException("target.kind is required", "target.kind");
            if (args.Target.Kind != "form" && args.Target.Kind != "entry")
                throw new ArgumentException(
                    $"target.kind must be 'form' or 'entry' (got '{args.Target.Kind}')", "target.kind");
            if (args.Target.Kind == "entry" && string.IsNullOrEmpty(args.Target.EntityKey))
                throw new ArgumentException(
                    "target.entityKey is required when target.kind='entry'", "target.entityKey");
            if (string.IsNullOrEmpty(args.ButtonKey))
                throw new ArgumentException("buttonKey is required", "buttonKey");
            if (string.IsNullOrEmpty(args.ButtonId))
                throw new ArgumentException("buttonId is required", "buttonId");
            if (string.IsNullOrEmpty(args.Caption))
                throw new ArgumentException("caption is required", "caption");
            if (string.IsNullOrEmpty(args.BoundOperationKey))
                throw new ArgumentException("boundOperationKey is required", "boundOperationKey");
            if (string.IsNullOrEmpty(args.ToolbarKey))
                throw new ArgumentException("toolbarKey is required", "toolbarKey");
            if (string.IsNullOrEmpty(args.BarDataManagerId))
                throw new ArgumentException("barDataManagerId is required", "barDataManagerId");
            if (string.IsNullOrEmpty(args.FormBusinessServiceId))
                throw new ArgumentException("formBusinessServiceId is required", "formBusinessServiceId");
            if (string.IsNullOrEmpty(args.BarItemLinkId))
                throw new ArgumentException("barItemLinkId is required", "barItemLinkId");

            var formMeta = _serializer.DeserializeFromString(args.Xml)
                ?? throw new InvalidOperationException("DeserializeFromString returned null");

            // Pre-flight 1: bound op must exist on Form.FormOperations.
            // Skipped silently if the FormMetadata has no BusinessInfo (which
            // shouldn't happen for any real BOS-saved input); the bound-op
            // check then re-throws the canonical "boundOperationKey ... 不存在".
            var businessInfo = formMeta.GetType().GetProperty("BusinessInfo")?.GetValue(formMeta);
            var form = businessInfo != null ? FindFormElement(businessInfo) : null;
            if (form == null || !FormHasOperationKey(form, args.BoundOperationKey))
            {
                throw new InvalidOperationException(
                    $"boundOperationKey \"{args.BoundOperationKey}\" 不存在");
            }

            // Resolve target Appearance (form-level FormAppearance OR
            // entry-level EntryEntityAppearance keyed by entity key).
            var layoutInfos = formMeta.GetType().GetProperty("LayoutInfos")?.GetValue(formMeta) as IEnumerable
                ?? throw new InvalidOperationException(
                    "FormMetadata.LayoutInfos missing — cannot place toolbar button without an appearance container");
            var appearance = FindTargetAppearance(layoutInfos, args.Target.Kind, args.Target.EntityKey);
            if (appearance == null)
            {
                throw new InvalidOperationException(
                    args.Target.Kind == "form"
                        ? "FormAppearance 未找到 — form 顶层 layout 不存在"
                        : $"entityKey \"{args.Target.EntityKey}\" 对应的 EntryEntityAppearance 未找到");
            }

            // Pre-flight 2: button key must be globally unique across all
            // BarItems collections (form + every entry-level appearance).
            // Matches BOS Designer's own "按钮 X 已存在" save-time validation.
            foreach (var ap in EnumerateAppearances(layoutInfos))
            {
                var existingBdm = GetMenuBarDataManager(ap);
                if (existingBdm == null) continue;
                if (existingBdm.GetType().GetProperty("BarItems")?.GetValue(existingBdm) is IEnumerable items)
                {
                    foreach (var item in items)
                    {
                        if (item == null) continue;
                        if (item.GetType().Name != "BarButtonItem") continue;
                        if (string.Equals(ReadStringProperty(item, "Key"), args.ButtonKey, StringComparison.Ordinal))
                            throw new InvalidOperationException($"按钮 {args.ButtonKey} 已存在");
                    }
                }
            }

            // Get-or-create the BarDataManager on the target appearance.
            // FormAppearance.Menu / EntryEntityAppearance.Menu are both typed
            // BarDataManager (decompiled at bos-core-full.cs:291621 / :55114).
            // No intermediate Menu wrapper — the property name is Menu and the
            // type IS BarDataManager.
            var bdm = GetOrCreateMenuBarDataManager(appearance, args.BarDataManagerId);

            // BarItems mutation: DcxmlSerializer calls EndInit() on every
            // ISupportInitialize after deserialization
            // (DcxmlSerializerReadImplement.cs:530-541). Post-EndInit,
            // BarDataManager.BarItems getter (decompiled
            // C:/.../Kingdee.BOS.Core.dll → BarDataManager) returns a
            // **fresh copy** of `_allBarItems.Values` rather than a backing
            // list — Adding to that copy is a silent no-op for the next
            // SerializeToString. Use the public AddBarItem(BarItem) method
            // which mutates the underlying `_allBarItems` dictionary
            // directly (decompile shows `_allBarItems[barItem.Name] = barItem`).
            //
            // BarItemLinks getter returns the backing `_barItemLinks` list
            // directly when not _isIniting, so Add() on the IList works —
            // but we use the public AddBarItemLink(BarItemLink) for symmetry
            // and to honor any future BOS-side mutation hooks.

            // ── Build BarButtonItem ──────────────────────────────────────
            // BarButtonItem ctor sets ElementType=2005 + Style=BarButtonItem
            // automatically (bos-core-full.cs:272813). BarItem ctor (line
            // 216247) pre-initializes ClickActions = new List<FormBusinessService>(),
            // ToolTip = new LocaleValue(), Description = new LocaleValue() —
            // we override Description / Caption with the caller-supplied
            // strings via SetProp's LocaleValue(string) ctor coercion.
            var barButtonType = ResolveType("Kingdee.BOS.Core.Metadata.BarElement.BarButtonItem")
                ?? throw new InvalidOperationException(
                    "Kingdee.BOS.Core.Metadata.BarElement.BarButtonItem not found in BOS Core");
            var btn = Activator.CreateInstance(barButtonType)!;
            // Wire-order subnodes per recon §4.2 — the underlying types are:
            //   ImageKey/Shortcut: string (BarItem) — left at default empty
            //   Seq: int — caller-supplied
            //   Description: LocaleValue — coerced from string ctor
            //   IsShowTitle: bool — true (button visible w/ caption)
            //   ClickActions: List<FormBusinessService> — pre-init'd by ctor
            //   Caption: LocaleValue — coerced from string ctor
            //   Id: string (Appearance.Id GUID, no dashes per req-96)
            //   Key: string — caller-supplied, must be ISV-prefixed
            SetProp(btn, "Key", args.ButtonKey);
            SetProp(btn, "Id", args.ButtonId);
            SetProp(btn, "Seq", args.Seq);
            // BarItem.Description is LocaleValue (216208); req-96 ships
            // <Description>按钮</Description> inline — LocaleValue's
            // single-string-arg ctor wraps the value via ConvertValue's
            // LocaleValue-detection path. Default to "按钮" matching the
            // canonical Designer-emitted value when caller omits it.
            SetProp(btn, "Description", string.IsNullOrEmpty(args.Description) ? "按钮" : args.Description);
            SetProp(btn, "IsShowTitle", true);
            SetProp(btn, "Caption", args.Caption);

            // ClickActions: bind to existing FormOperation via
            // FormBusinessService(ActionId=23, Parameters=["<opKey>"]).
            // ClickActions list is already non-null per BarItem ctor; pull
            // and append rather than re-creating.
            var clickActions = btn.GetType().GetProperty("ClickActions")?.GetValue(btn) as IList
                ?? throw new InvalidOperationException("BarItem.ClickActions getter returned null");
            var fbsType = ResolveType("Kingdee.BOS.Core.Metadata.FormElement.FormBusinessService")
                ?? throw new InvalidOperationException(
                    "Kingdee.BOS.Core.Metadata.FormElement.FormBusinessService not found in BOS Core");
            var fbs = Activator.CreateInstance(fbsType)!;
            SetProp(fbs, "Id", args.FormBusinessServiceId);
            // ActionId is `long` on FormBusinessService (consistent with
            // 5.12.3b's add_entity_service_rule path which sets long ActionId).
            // 23 = "调用表单操作" — recon §4.4 + capture req-96.
            SetProp(fbs, "ActionId", 23L);
            // Parameters is a string holding a JSON array; the Parameters
            // accessor re-encodes on get. Inline-stringify the JSON to match
            // wire `<Parameters>["TESTCopy"]</Parameters>` exactly.
            SetProp(fbs, "Parameters", $"[\"{args.BoundOperationKey}\"]");
            // Description is LocaleValue (FormBusinessService); template
            // matches BOS Designer's auto-generated "调用表单操作--{operationName}"
            // per recon §4.4. Caller-supplied operationName falls back to
            // operationKey (BOS Designer also accepts that).
            var displayName = string.IsNullOrEmpty(args.BoundOperationName)
                ? args.BoundOperationKey
                : args.BoundOperationName;
            SetProp(fbs, "Description", $"调用表单操作--{displayName}");
            clickActions.Add(fbs);

            // Mutate `_allBarItems` via public AddBarItem (see comment above).
            // Reflection invoke to avoid taking a compile-time dep on
            // BarDataManager / BarItem types in the bridge csproj.
            var addBarItem = bdm.GetType().GetMethod("AddBarItem", new[] { ResolveType("Kingdee.BOS.Core.Metadata.BarElement.BarItem")! })
                ?? throw new InvalidOperationException(
                    "BarDataManager.AddBarItem(BarItem) not found");
            addBarItem.Invoke(bdm, new object[] { btn });

            // ── Build BarItemLink ────────────────────────────────────────
            // BarItemLink ctor defaults ParentKey="ToolBar" (bos-core-full.cs:253045)
            // — we override with the caller's toolbarKey. Id is a dashed GUID
            // string per wire shape (`<Id>3cce5895-faf8-44af-b1d6-b7f8ac607378</Id>`);
            // BarItemKey references the BarButtonItem.Key.
            var linkType = ResolveType("Kingdee.BOS.Core.Metadata.BarElement.BarItemLink")
                ?? throw new InvalidOperationException(
                    "Kingdee.BOS.Core.Metadata.BarElement.BarItemLink not found in BOS Core");
            var link = Activator.CreateInstance(linkType)!;
            SetProp(link, "Id", args.BarItemLinkId);
            SetProp(link, "BarItemKey", args.ButtonKey);
            SetProp(link, "ParentKey", args.ToolbarKey);
            // BarDataManager.AddBarItemLink(link) silently returns false when
            // `_allBarItems[link.ParentKey]` is missing — i.e. when the
            // toolbar BarItem itself isn't in the appearance's menu (which
            // is the v0.1 reality: the toolbar lives on the parent form,
            // not in the extension's appearance copy). We bypass that guard
            // by mutating the backing `_barItemLinks` list directly via the
            // BarItemLinks getter, which post-EndInit returns the underlying
            // List<BarItemLink> reference (not a copy — verified by IL of
            // BarDataManager getter at `_isIniting=false` branch:
            // `return _barItemLinks;`). Wire-correctness is what matters
            // for our v0.1 contract; the runtime "link → topology" tracking
            // AddBarItemLink does is only relevant for the BOS Designer's
            // in-memory tree which we don't run.
            var barItemLinksList = bdm.GetType()
                .GetProperty("BarItemLinks", BindingFlags.Public | BindingFlags.Instance)
                ?.GetValue(bdm) as IList
                ?? throw new InvalidOperationException(
                    $"{bdm.GetType().FullName}.BarItemLinks getter returned null");
            barItemLinksList.Add(link);

            return _serializer.SerializeToString(formMeta, null);
        }

        /// <summary>
        /// Remove a <c>BarButtonItem</c> from the target Appearance's
        /// <c>Menu</c> (BarDataManager) by its <c>Key</c>, plus the matching
        /// <c>BarItemLink</c> entry whose <c>BarItemKey</c> equals the same
        /// key. Walks every Appearance across every LayoutInfo (the button
        /// could live on either the form-level FormAppearance or any
        /// EntryEntityAppearance) — first match wins. Throws
        /// <see cref="InvalidOperationException"/> with a 中文 "不存在" message
        /// when no match is found, matching the symmetry with
        /// <see cref="AddToolbarButton"/>'s "已存在" duplicate guard so the
        /// agent-facing tool surfaces consistent error wording.
        ///
        /// Mutation strategy: the public <c>BarDataManager.RemoveBarItem</c>
        /// method exists (decompiled at properties/BarDataManager.cs:526),
        /// but its body walks <c>BarItem.GetParent()</c> and conditionally
        /// chains through several <c>EnumBarItemStyle</c> branches that only
        /// behave correctly when the BarItem has a wired-up parent graph.
        /// In v0.1's reality, our extension's BarDataManager doesn't contain
        /// the parent ToolBar (which lives on the parent form's appearance
        /// copy), so <c>GetParent()</c> returns an empty list and the
        /// logic's switch-case can take unintended paths. Avoid the public
        /// API; reach for the underlying <c>_allBarItems</c> dictionary +
        /// <c>_barItemLinks</c> list directly via reflection. This is a
        /// mirror of how Task 2.4 mutated <c>_barItemLinks</c> directly
        /// (the BarItemLinks getter post-EndInit returns the live ref) —
        /// and `_allBarItems` removal is symmetric: BarItems getter in
        /// post-EndInit mode returns a fresh copy, but the next
        /// SerializeToString triggers BeginInit which lazy-rebuilds
        /// `_serBarItems` from `_allBarItems` (line 76-93 of BarDataManager
        /// decompile), so direct dictionary mutation is what reaches the
        /// wire.
        /// </summary>
        public string RemoveToolbarButton(string xml, string buttonKey)
        {
            if (string.IsNullOrEmpty(xml)) throw new ArgumentException("xml is empty", nameof(xml));
            if (string.IsNullOrEmpty(buttonKey))
                throw new ArgumentException("buttonKey is empty", nameof(buttonKey));

            var formMeta = _serializer.DeserializeFromString(xml)
                ?? throw new InvalidOperationException("DeserializeFromString returned null");

            // FormMetadata may legitimately have no LayoutInfos (the
            // operations-no-ops fixture is an example) — that's a fast-path
            // "not found" since there's nowhere a button could live.
            var layoutInfos = formMeta.GetType().GetProperty("LayoutInfos")?.GetValue(formMeta) as IEnumerable;
            if (layoutInfos == null)
                throw new InvalidOperationException($"按钮 {buttonKey} 不存在");

            foreach (var ap in EnumerateAppearances(layoutInfos))
            {
                var bdm = GetMenuBarDataManager(ap);
                if (bdm == null) continue;

                // Locate the BarButtonItem by Key in `_allBarItems`. Use
                // the public BarItems getter (which post-EndInit returns
                // a fresh List<BarItem> copy) only as a search index —
                // the actual remove operation goes against the underlying
                // dictionary.
                var barItemsRaw = bdm.GetType().GetProperty("BarItems")?.GetValue(bdm) as IEnumerable;
                if (barItemsRaw == null) continue;

                object? targetBtn = null;
                foreach (var item in barItemsRaw)
                {
                    if (item == null) continue;
                    if (item.GetType().Name != "BarButtonItem") continue;
                    if (string.Equals(ReadStringProperty(item, "Key"), buttonKey, StringComparison.Ordinal))
                    {
                        targetBtn = item;
                        break;
                    }
                }
                if (targetBtn == null) continue;

                // Reflect-mutate `_allBarItems` directly. The dictionary's
                // key is BarItem.Name (decompile line 133, line 346:
                // `_allBarItems[barItem.Name] = barItem`). BarItem.Name
                // == BarItem.Key by default per BarItem ctor (216247),
                // and Designer never deviates — but read Name explicitly
                // to be safe rather than assuming Key==Name.
                var allBarItemsField = bdm.GetType().GetField(
                    "_allBarItems",
                    BindingFlags.NonPublic | BindingFlags.Instance);
                if (allBarItemsField == null)
                    throw new InvalidOperationException(
                        $"{bdm.GetType().FullName} has no _allBarItems field");
                if (!(allBarItemsField.GetValue(bdm) is IDictionary allBarItems))
                    throw new InvalidOperationException(
                        $"{bdm.GetType().FullName}._allBarItems is null or non-dictionary");

                var barItemName = ReadStringProperty(targetBtn, "Name") ?? buttonKey;
                if (allBarItems.Contains(barItemName))
                {
                    allBarItems.Remove(barItemName);
                }
                else if (allBarItems.Contains(buttonKey))
                {
                    // Defensive fallback when Name and Key diverged. Should
                    // be unreachable in practice — BarItem.Name getter
                    // returns Key when the underlying field is empty
                    // (decompile bos-core-full.cs:216293) — but keep the
                    // path tight so a stale `_allBarItems` entry can still
                    // be evicted by either lookup.
                    allBarItems.Remove(buttonKey);
                }

                // Mirror the BarItemLink remove. BarItemLinks getter
                // post-EndInit returns the live `_barItemLinks` list ref
                // (decompile line 168), so List<T>.Remove(target) actually
                // mutates the backing collection. Delete the FIRST link
                // whose BarItemKey matches — Task 2.4's add path created
                // exactly one link per button so first-match-wins is safe.
                var barItemLinksList = bdm.GetType()
                    .GetProperty("BarItemLinks", BindingFlags.Public | BindingFlags.Instance)
                    ?.GetValue(bdm) as IList;
                if (barItemLinksList != null)
                {
                    object? targetLink = null;
                    foreach (var link in barItemLinksList)
                    {
                        if (link == null) continue;
                        if (string.Equals(ReadStringProperty(link, "BarItemKey"), buttonKey, StringComparison.Ordinal))
                        {
                            targetLink = link;
                            break;
                        }
                    }
                    if (targetLink != null) barItemLinksList.Remove(targetLink);
                }

                return _serializer.SerializeToString(formMeta, null);
            }

            throw new InvalidOperationException($"按钮 {buttonKey} 不存在");
        }

        /// <summary>
        /// Walk every Appearance across every LayoutInfo. Used by both
        /// pre-flight checks (cross-appearance dup buttonKey scan) and the
        /// resolve-target-appearance helper. LayoutInfos enumeration mirrors
        /// the read-side <see cref="ListOperations"/> implementation so the
        /// list / add paths walk the same elements.
        /// </summary>
        private static IEnumerable<object> EnumerateAppearances(IEnumerable layoutInfos)
        {
            foreach (var li in layoutInfos)
            {
                if (li == null) continue;
                var apsRaw = li.GetType().GetProperty("Appearances")?.GetValue(li) as IEnumerable;
                if (apsRaw == null) continue;
                foreach (var ap in apsRaw)
                {
                    if (ap == null) continue;
                    yield return ap;
                }
            }
        }

        /// <summary>
        /// Resolve the target Appearance for a button placement. For
        /// <c>kind="form"</c> the first FormAppearance wins (a FormMetadata
        /// has exactly one form-level layout in practice — the user-facing
        /// "form 顶层 toolbar"). For <c>kind="entry"</c> we match by Key on
        /// EntryEntityAppearance (entry key, e.g. "FEntity"). Returns null
        /// when no match — caller throws a 中文 not-found error.
        /// </summary>
        private static object? FindTargetAppearance(IEnumerable layoutInfos, string kind, string? entityKey)
        {
            foreach (var ap in EnumerateAppearances(layoutInfos))
            {
                var typeName = ap.GetType().Name;
                if (kind == "form" && typeName == "FormAppearance") return ap;
                if (kind == "entry" && typeName == "EntryEntityAppearance"
                    && string.Equals(ReadStringProperty(ap, "Key"), entityKey, StringComparison.Ordinal))
                    return ap;
            }
            return null;
        }

        /// <summary>
        /// Read the appearance's <c>Menu</c> BarDataManager without creating
        /// it. Used for the cross-appearance dup-key scan — appearances
        /// without a Menu have no buttons to clash, so we skip them.
        /// </summary>
        private static object? GetMenuBarDataManager(object appearance)
        {
            return appearance.GetType()
                .GetProperty("Menu", BindingFlags.Public | BindingFlags.Instance)
                ?.GetValue(appearance);
        }

        /// <summary>
        /// Get-or-create the appearance's <c>Menu</c> BarDataManager and
        /// stamp its <c>Id</c> when blank. FormAppearance.Menu /
        /// EntryEntityAppearance.Menu are both typed
        /// <c>Kingdee.BOS.Core.Metadata.BarElement.BarDataManager</c> with
        /// public setters (decompiled at bos-core-full.cs:291621 / :55114),
        /// so we can Activator.CreateInstance + SetValue when the menu was
        /// previously absent (e.g. extension didn't ship its own LayoutInfo
        /// menu — fixture operations-no-ops.xml is the canonical case;
        /// however that fixture has no LayoutInfos at all, so this path is
        /// only exercised for partially-shipped fixtures in the wild).
        /// </summary>
        private static object GetOrCreateMenuBarDataManager(object appearance, string barDataManagerId)
        {
            var menuProp = appearance.GetType().GetProperty("Menu", BindingFlags.Public | BindingFlags.Instance)
                ?? throw new InvalidOperationException(
                    $"{appearance.GetType().FullName} has no Menu property");
            var bdm = menuProp.GetValue(appearance);
            if (bdm == null)
            {
                var bdmType = ResolveType("Kingdee.BOS.Core.Metadata.BarElement.BarDataManager")
                    ?? throw new InvalidOperationException(
                        "Kingdee.BOS.Core.Metadata.BarElement.BarDataManager not found in BOS Core");
                bdm = Activator.CreateInstance(bdmType)!;
                // BarDataManager has _isIniting=false by default. Calling
                // BeginInit() flips it to true so the BarItems / BarItemLinks
                // getters lazy-build their `_serXxx` lists from `_allBarItems`
                // / `_barItemLinks`. Without this, the getter returns the
                // null backing field (line 282260 IL_0095 path), and Add()
                // would NRE.
                var beginInit = bdmType.GetMethod("BeginInit", Type.EmptyTypes);
                beginInit?.Invoke(bdm, null);
                menuProp.SetValue(appearance, bdm);
            }
            // Stamp Id when blank — the property has a Guid.NewGuid()
            // fallback in its getter (bos-core-full.cs:282200), but emitting
            // the caller-supplied id keeps round-trips byte-stable.
            if (string.IsNullOrEmpty(ReadStringProperty(bdm, "Id")))
                SetProp(bdm, "Id", barDataManagerId);
            return bdm;
        }

        /// <summary>
        /// Test whether the given Form's <c>FormOperations</c> collection
        /// contains an entry with <c>Operation == operationKey</c>. Used by
        /// <see cref="AddToolbarButton"/>'s pre-flight validation — BOS
        /// Designer rejects "click action references a missing operation"
        /// at save time so we mirror that contract.
        /// </summary>
        private static bool FormHasOperationKey(object form, string operationKey)
        {
            var opsRaw = form.GetType().GetProperty("FormOperations", BindingFlags.Public | BindingFlags.Instance)
                ?.GetValue(form);
            if (!(opsRaw is IEnumerable ops)) return false;
            foreach (var op in ops)
            {
                if (op == null) continue;
                if (string.Equals(ReadStringProperty(op, "Operation"), operationKey, StringComparison.Ordinal))
                    return true;
            }
            return false;
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

            // The toolbar key this button attaches to (BarItemLink.ParentKey).
            // BarItemLink ctor defaults this to "ToolBar"; callers can
            // override via add_toolbar_button's `toolbarKey` arg. Null when
            // no matching BarItemLink exists (orphan BarButtonItem case;
            // 5.12.6 v0.1 always pairs button + link, but a future "create
            // shell button" path could leave links empty).
            [JsonProperty("toolbarKey")]
            public string? ToolbarKey { get; set; }
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

            // Optional — extension's form id (ext.id, dashed or compact GUID).
            // Required when the source XML has no Form overlay (typical of a
            // freshly-created extension that hasn't yet had any element
            // written). Bridge synthesizes Form action="edit" oid="BOS_BillModel"
            // with this Id when it can't find an existing Form. Connector
            // wrappers always pass this; legacy callers (or fixture tests
            // with full baseline) can omit and bridge falls back to FindForm.
            [JsonProperty("extensionFormId")]
            public string? ExtensionFormId { get; set; }
        }

        // ── add_toolbar_button args DTO (Plan 5.12.6 Task 2.4) ────────────
        // The Newtonsoft pattern mirrors AddCustomOperationArgs above; agents
        // pass a JSON object with camelCase keys (target, buttonKey, …) and
        // the Dispatch path binds via req.ToObject<AddToolbarButtonArgs>().

        internal sealed class AddToolbarButtonArgs
        {
            [JsonProperty("xml")]
            public string Xml { get; set; } = string.Empty;

            // Required: { kind: 'form' | 'entry', entityKey?: string }.
            // entityKey is required when kind='entry'; ignored otherwise.
            [JsonProperty("target")]
            public ToolbarButtonTarget Target { get; set; } = new ToolbarButtonTarget();

            [JsonProperty("buttonKey")]
            public string ButtonKey { get; set; } = string.Empty;

            // 32-hex GUID string (no dashes) per req-96 wire shape.
            [JsonProperty("buttonId")]
            public string ButtonId { get; set; } = string.Empty;

            [JsonProperty("caption")]
            public string Caption { get; set; } = string.Empty;

            // Defaults to "按钮" matching BOS Designer's default Description
            // value (req-96 ships <Description>按钮</Description>). Callers
            // can override with a richer description if needed.
            [JsonProperty("description")]
            public string? Description { get; set; }

            // BarItem.Seq is `int`; default 1 if caller omits.
            [JsonProperty("seq")]
            public int Seq { get; set; } = 1;

            // The Form.FormOperations.Operation key this button calls when
            // clicked. Pre-flight checked: must already exist in the form.
            [JsonProperty("boundOperationKey")]
            public string BoundOperationKey { get; set; } = string.Empty;

            // The bound operation's display name — interpolated into
            // FormBusinessService.Description as "调用表单操作--{operationName}".
            // Falls back to BoundOperationKey when null/empty (still valid).
            [JsonProperty("boundOperationName")]
            public string? BoundOperationName { get; set; }

            // The toolbar this button attaches to (BarItemLink.ParentKey).
            // v0.1 assumes the toolbar already exists (user seeds via BOS
            // Designer); the bridge does not auto-create a ToolBar.
            [JsonProperty("toolbarKey")]
            public string ToolbarKey { get; set; } = string.Empty;

            // Caller-provided GUIDs for idempotent re-runs — same uuid =
            // byte-stable diff. Dashed UUIDs for managers / services / links;
            // 32-hex (no dashes) for buttonId per wire shape.
            [JsonProperty("barDataManagerId")]
            public string BarDataManagerId { get; set; } = string.Empty;

            [JsonProperty("formBusinessServiceId")]
            public string FormBusinessServiceId { get; set; } = string.Empty;

            [JsonProperty("barItemLinkId")]
            public string BarItemLinkId { get; set; } = string.Empty;

            // Optional — see AddCustomOperationArgs.ExtensionFormId.
            [JsonProperty("extensionFormId")]
            public string? ExtensionFormId { get; set; }
        }

        internal sealed class ToolbarButtonTarget
        {
            [JsonProperty("kind")]
            public string Kind { get; set; } = string.Empty;

            [JsonProperty("entityKey")]
            public string? EntityKey { get; set; }
        }
    }
}
