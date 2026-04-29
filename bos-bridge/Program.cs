using System;

namespace OpenDeploy.BosBridge
{
    /// <summary>
    /// Phase 1: load DcxmlSerializer from the local K/3 install and exit.
    /// Phase 2 will add an NDJSON request/response loop on stdin/stdout.
    /// </summary>
    internal static class Program
    {
        private static int Main(string[] args)
        {
            var resolver = DllResolver.Create();
            Console.WriteLine($"install_path: {resolver.InstallPath ?? "<not found>"}");
            if (resolver.InstallPath == null)
            {
                Console.Error.WriteLine("set BOS_BRIDGE_DESKCLIENT to the K3CloudClient directory");
                return 1;
            }

            resolver.Hook();
            try
            {
                var asm = resolver.LoadAssembly("Kingdee.BOS.DataEntity");
                var serializer = asm.GetType("Kingdee.BOS.Serialization.DcxmlSerializer");
                var listBinder = asm.GetType("Kingdee.BOS.Serialization.ListDcxmlBinder");
                Console.WriteLine($"assembly: {asm.FullName}");
                Console.WriteLine($"DcxmlSerializer: {(serializer != null ? "OK" : "MISSING")}");
                Console.WriteLine($"ListDcxmlBinder: {(listBinder != null ? "OK" : "MISSING")}");
                return (serializer != null && listBinder != null) ? 0 : 2;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"load failed: {ex.GetType().Name}: {ex.Message}");
                return 3;
            }
        }
    }
}
