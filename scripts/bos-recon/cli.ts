/**
 * bos-recon CLI — 开发环境 BOS 侦察工具链入口。
 *
 * 用法: pnpm recon:<subcommand> -- [args]
 * subcommands: snapshot-before / xe-start / xe-stop / snapshot-after / diff
 *
 * 每个 subcommand 的具体 args 由各自的模块负责;本入口只做路由。
 */

type Subcommand =
  | 'snapshot-before'
  | 'xe-start'
  | 'xe-stop'
  | 'snapshot-after'
  | 'diff';

const KNOWN: readonly Subcommand[] = [
  'snapshot-before',
  'xe-start',
  'xe-stop',
  'snapshot-after',
  'diff'
] as const;

function isSubcommand(s: string): s is Subcommand {
  return (KNOWN as readonly string[]).includes(s);
}

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;
  if (!sub || !isSubcommand(sub)) {
    console.error(
      `usage: pnpm recon:<subcommand> -- [args]\n` +
        `  subcommands: ${KNOWN.join(' / ')}`
    );
    process.exit(2);
  }
  // TODO: route to subcommand modules in follow-up tasks.
  console.log(`[bos-recon] subcommand=${sub} args=${JSON.stringify(rest)}`);
}

main().catch((err) => {
  console.error('[bos-recon] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
