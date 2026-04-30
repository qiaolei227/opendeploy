// Stand-in for opendeploy-bos-serializer.exe used by BridgeClient unit tests.
// Implements the same NDJSON protocol with cheap synthetic ops:
//   ping             → "pong"
//   echo {value}     → echoes value
//   fail             → BridgeError TestError
//   slow {ms}        → resolves after ms (use to test timeout)
//   log {message}    → writes to stderr then resolves "logged"
//   bad-line         → emits a non-JSON line on stdout (orphan handling)

let buf = '';
process.stdin.setEncoding('utf8');
process.stderr.write('[fake-bridge] ready\n');

process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).replace(/\r$/, '');
    buf = buf.slice(nl + 1);
    if (line.length === 0) continue;
    handle(line);
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});

function handle(line) {
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'ParseError', message: e.message }) + '\n');
    return;
  }
  switch (req.op) {
    case 'ping':
      reply({ id: req.id, ok: true, result: 'pong' });
      return;
    case 'echo':
      reply({ id: req.id, ok: true, result: req.value });
      return;
    case 'fail':
      reply({ id: req.id, ok: false, code: 'TestError', message: 'fail requested' });
      return;
    case 'slow':
      setTimeout(() => reply({ id: req.id, ok: true, result: 'slow' }), req.ms ?? 200);
      return;
    case 'log':
      process.stderr.write('[fake-bridge] ' + req.message + '\n');
      reply({ id: req.id, ok: true, result: 'logged' });
      return;
    case 'bad-line':
      process.stdout.write('not json at all\n');
      reply({ id: req.id, ok: true, result: 'after-bad' });
      return;
    default:
      reply({ id: req.id, ok: false, code: 'unknown_op', message: req.op });
  }
}

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
