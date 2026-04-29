using System;
using System.IO;
using System.Reflection;

namespace OpenDeploy.BosBridge
{
    /// <summary>
    /// Locates the user's K/3 Cloud DeskClient install and registers an
    /// AssemblyResolve hook so transitive Kingdee.* references load from
    /// the same directory. The bridge never redistributes Kingdee DLLs —
    /// they must be present on the customer machine.
    /// </summary>
    internal sealed class DllResolver
    {
        private const string EnvVar = "BOS_BRIDGE_DESKCLIENT";

        private static readonly string[] CandidatePaths =
        {
            @"C:\Program Files (x86)\Kingdee\K3Cloud\DeskClient\K3CloudClient",
            @"C:\Program Files\Kingdee\K3Cloud\DeskClient\K3CloudClient",
        };

        public string? InstallPath { get; }

        private DllResolver(string? installPath) => InstallPath = installPath;

        public static DllResolver Create()
        {
            var fromEnv = Environment.GetEnvironmentVariable(EnvVar);
            if (!string.IsNullOrEmpty(fromEnv) && Directory.Exists(fromEnv))
                return new DllResolver(fromEnv);

            foreach (var p in CandidatePaths)
                if (Directory.Exists(p)) return new DllResolver(p);

            return new DllResolver(null);
        }

        public void Hook()
        {
            if (InstallPath == null) return;
            AppDomain.CurrentDomain.AssemblyResolve += (_, args) =>
            {
                var name = new AssemblyName(args.Name).Name;
                if (string.IsNullOrEmpty(name)) return null;
                var path = Path.Combine(InstallPath, name + ".dll");
                return File.Exists(path) ? Assembly.LoadFrom(path) : null;
            };
        }

        public Assembly LoadAssembly(string simpleName)
        {
            if (InstallPath == null)
                throw new InvalidOperationException("install path not located");
            var path = Path.Combine(InstallPath, simpleName + ".dll");
            if (!File.Exists(path))
                throw new FileNotFoundException("not found in install dir", path);
            return Assembly.LoadFrom(path);
        }
    }
}
