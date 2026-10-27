require('dotenv').config();
const dns = require('dns');
const { execFileSync } = require('child_process');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const PointTransaction = require('../src/models/PointTransaction');
const { computeLifetimePoints } = require('../src/services/loyalty.service');

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

function parseArgs(argv) {
  const positional = [];
  let uriOverride = process.env.MONGODB_URI;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--uri' && argv[i + 1]) {
      uriOverride = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  return { email: positional[0] || 'anhnp23406@st.uel.edu.vn', uri: uriOverride };
}

function parseSrvUri(srvUri) {
  const m = srvUri.match(/^mongodb\+srv:\/\/([^/]+)(\/[^?]*)?(\?.*)?$/i);
  if (!m) return null;
  const authority = m[1];
  const dbPath = m[2] || '/';
  const query = (m[3] || '').replace(/^\?/, '');
  const at = authority.lastIndexOf('@');
  const authPrefix = at >= 0 ? `${authority.slice(0, at + 1)}` : '';
  const clusterHost = at >= 0 ? authority.slice(at + 1) : authority;
  return { authPrefix, clusterHost, dbPath, query, srvHost: `_mongodb._tcp.${clusterHost}` };
}

function seedUriFromHosts(parsed, hostPorts) {
  const params = new URLSearchParams(parsed.query);
  params.set('ssl', 'true');
  params.set('authSource', 'admin');
  if (process.env.MONGODB_REPLICA_SET) {
    params.set('replicaSet', process.env.MONGODB_REPLICA_SET);
  }
  const path = parsed.dbPath.startsWith('/') ? parsed.dbPath : `/${parsed.dbPath}`;
  return `mongodb://${parsed.authPrefix}${hostPorts.join(',')}${path}?${params.toString()}`;
}

async function resolveSrvHosts(srvHost) {
  const servers = ['123.23.23.23', '8.8.8.8', '1.1.1.1'];
  if (typeof dns.setServers === 'function') {
    dns.setServers(servers);
  }

  try {
    const records = await dns.promises.resolveSrv(srvHost);
    return records.map((r) => `${r.name.replace(/\.$/, '')}:${r.port || 27017}`);
  } catch (nodeErr) {
    // Windows: Node c-ares sometimes returns querySrv ECONNREFUSED while nslookup works.
    try {
      const out = execFileSync('nslookup', ['-type=SRV', srvHost], {
        encoding: 'utf8',
        windowsHide: true
      });
      const hosts = [];
      for (const line of out.split(/\r?\n/)) {
        const match = line.match(/svr hostname\s*=\s*(\S+)/i);
        if (match) {
          hosts.push(`${match[1].replace(/\.$/, '')}:27017`);
        }
      }
      if (hosts.length) return hosts;
    } catch {
      // ignore
    }
    throw nodeErr;
  }
}

async function resolveMongoUri(inputUri) {
  if (!inputUri || !inputUri.startsWith('mongodb+srv://')) {
    return inputUri;
  }

  if (process.env.MONGODB_SEED_HOSTS) {
    const parsed = parseSrvUri(inputUri);
    if (parsed) {
      const hosts = process.env.MONGODB_SEED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean);
      return seedUriFromHosts(parsed, hosts);
    }
  }

  const parsed = parseSrvUri(inputUri);
  if (!parsed) return inputUri;

  const hostPorts = await resolveSrvHosts(parsed.srvHost);
  return seedUriFromHosts(parsed, hostPorts);
}

async function main() {
  const { email, uri: inputUri } = parseArgs(process.argv);
  if (!inputUri) {
    console.error('Missing MONGODB_URI in backend/.env (or pass --uri "...").');
    process.exit(1);
  }

  const uri = await resolveMongoUri(inputUri);
  const masked = uri.replace(/:([^:@/]+)@/, ':***@');
  console.log('Connecting:', masked.startsWith('mongodb://') ? '(seed list) ' : '', masked);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });

  const user = await User.findOne({ email: email.toLowerCase() }).lean();
  if (!user) {
    console.log('User not found:', email);
    process.exit(1);
  }

  const lifetime = await computeLifetimePoints(user.user_id);
  const txns = await PointTransaction.find({ user_id: user.user_id }).sort({ created_at: 1 }).lean();

  const sumPostedBalance = txns
    .filter((t) => t.status === 'posted' && typeof t.amount === 'number')
    .reduce((s, t) => s + t.amount, 0);

  console.log(
    JSON.stringify(
      {
        user_id: user.user_id,
        email: user.email,
        availablePoints: user.points ?? 0,
        lifetimePoints: lifetime,
        ledgerPostedNet: sumPostedBalance,
        tier: user.membership_tier
      },
      null,
      2
    )
  );

  console.log('\nTransactions:');
  for (const t of txns) {
    console.log(
      `${t.created_at?.toISOString?.()?.slice(0, 19) || '?'} | ${t.type} | ${t.amount} | ${t.status} | ${t.ref_id || ''}`
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message || err);
  console.error(
    '\nTroubleshooting:\n' +
      '  • Atlas → Network Access → Add Current IP\n' +
      '  • Or set seed hosts (from Compass / Atlas standard string):\n' +
      '      $env:MONGODB_SEED_HOSTS="host1:27017,host2:27017,host3:27017"\n' +
      '      node scripts/tmp-check-user-points.js EMAIL\n' +
      '  • If needed: $env:MONGODB_REPLICA_SET="atlas-xxxxx-shard-0"\n'
  );
  process.exit(1);
});
