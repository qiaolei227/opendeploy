using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Reflection;
using Kingdee.BOS.Orm.Metadata.DataEntity;
using Kingdee.BOS.Orm.Metadata.DataEntity.CLR;
using Kingdee.BOS.Serialization;

namespace OpenDeploy.BosBridge
{
    /// <summary>
    /// Two overrides on top of ListDcxmlBinder:
    ///
    /// 1. `GetDataEntityType(object)` — base only resolves IDataEntityBase
    ///    and primitives, returning null for POCOs. ConvertRuleMetaData and
    ///    most BOS metadata classes are POCOs that don't extend DataEntityBase,
    ///    so the serializer fails with "must implement IDataEntityBase".
    ///    Falling back to the reflective static DataEntityType.GetDataEntityType
    ///    recovers the schema we already registered.
    ///
    /// 2. `GetDataEntityAttributes(object)` — base returns null. The K/3 server's
    ///    deserializer requires `ElementType="..."` attributes on every Element
    ///    (LinkEntityPolicy, FieldMap, ConvertRule, etc.) to identify the C#
    ///    class for each Policies-collection slot. Without the attribute the
    ///    server falls back to element-name lookup and fails with
    ///    "未能找到XX对应的数据类型". We reflect the entity's ElementType
    ///    (and the always-zero ElementStyle that BOS Designer also writes)
    ///    so the serialized DCXML matches the wire format the server expects.
    /// </summary>
    internal sealed class TolerantListBinder : ListDcxmlBinder
    {
        private static readonly ConcurrentDictionary<Type, PropertyInfo?> ElementTypePropCache = new();

        public TolerantListBinder(IEnumerable<IDataEntityType> dts) : base(dts) { }

        public override IDataEntityType GetDataEntityType(object dataEntity)
        {
            var fromBase = base.GetDataEntityType(dataEntity);
            if (fromBase != null) return fromBase;
            if (dataEntity == null) return null!;
            return DataEntityType.GetDataEntityType(dataEntity.GetType());
        }

        public override IDictionary<string, string>? GetDataEntityAttributes(object dataEntity)
        {
            if (dataEntity == null) return null;
            var prop = ElementTypePropCache.GetOrAdd(dataEntity.GetType(),
                t => t.GetProperty("ElementType", BindingFlags.Public | BindingFlags.Instance));
            if (prop == null || prop.PropertyType != typeof(int)) return null;

            var value = (int)prop.GetValue(dataEntity)!;
            if (value == 0) return null;

            return new Dictionary<string, string>(2)
            {
                { "ElementType", value.ToString(System.Globalization.CultureInfo.InvariantCulture) },
                { "ElementStyle", "0" },
            };
        }
    }
}
