using System.Collections.Generic;
using Kingdee.BOS.Orm.Metadata.DataEntity;
using Kingdee.BOS.Orm.Metadata.DataEntity.CLR;
using Kingdee.BOS.Serialization;

namespace OpenDeploy.BosBridge
{
    /// <summary>
    /// ListDcxmlBinder rejects POCOs in `GetDataEntityType(object)` — it only
    /// resolves IDataEntityBase instances and primitives. ConvertRuleMetaData
    /// and most other BOS metadata classes are POCOs that don't extend
    /// DataEntityBase, so the deserialized object tree fails the serialize-side
    /// `WriteObjectElement` lookup with "must implement IDataEntityBase".
    ///
    /// Falling back to the static reflective DataEntityType.GetDataEntityType
    /// on the entity's CLR type recovers the schema we already registered,
    /// letting serialize complete.
    /// </summary>
    internal sealed class TolerantListBinder : ListDcxmlBinder
    {
        public TolerantListBinder(IEnumerable<IDataEntityType> dts) : base(dts) { }

        public override IDataEntityType GetDataEntityType(object dataEntity)
        {
            var fromBase = base.GetDataEntityType(dataEntity);
            if (fromBase != null) return fromBase;
            if (dataEntity == null) return null!;
            return DataEntityType.GetDataEntityType(dataEntity.GetType());
        }
    }
}
