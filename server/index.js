import express from 'express';
import cors from 'cors';
import { buildDbConfig, getPool, one } from './db.js';
import routes from './routes/index.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/api', routes);

app.get('/', (req, res) => res.json({ name: 'Temple Seva Booking API', version: '4.1.0', storage: 'MSSQL', docs: 'See README.md', health: '/api/health' }));
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Errors: friendly messages for the user, details in the server log
const DB_DOWN = ['ESOCKET', 'ETIMEOUT', 'ECONNCLOSED', 'ELOGIN', 'EINSTLOOKUP', 'ENOTOPEN'];
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON in the request body' });
  if (err.status && err.expose) return res.status(err.status).json({ error: err.message });
  const number = err.number ?? err.originalError?.info?.number;
  if (number === 2627 || number === 2601) return res.status(409).json({ error: 'This record already exists (a value that must be unique is already used).' });
  if (number === 547) return res.status(409).json({ error: 'This record is linked to other records, so it cannot be changed or deleted. Deactivate it instead.' });
  if (number === 8152 || number === 2628) return res.status(400).json({ error: 'One of the values is too long.' });
  if (DB_DOWN.includes(err.code)) return res.status(503).json({ error: `Database unavailable: ${err.message}` });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', async () => {
  const cfg = buildDbConfig();
  console.log(`🚀 Temple API running on http://0.0.0.0:${PORT}`);
  console.log(`   Storage: MSSQL ${cfg.server}${cfg.server.includes('\\') ? '' : `:${cfg.port}`} / ${cfg.database}`);
  if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET is not set - using an insecure default. Set a long random JWT_SECRET in server/.env before going live.');
  try {
    await getPool();
    const v = await one("SELECT OBJECT_ID(N'dbo.sp_NextNumber', N'P') AS proc_, COL_LENGTH(N'dbo.Locations', N'UpiVpa') AS upi, COL_LENGTH(N'dbo.SevaCategories', N'CreatedBy') AS stamps");
    console.log('✅ Connected to the database');
    if (!v?.proc_ || !v?.upi || !v?.stamps) console.warn('⚠️  The database schema is older than this app (who created / changed each record is not stored yet). Run: npm run db:upgrade');
  } catch (e) {
    console.error(`❌ ${e.message}`);
    console.error('   The API keeps running and reconnects automatically. Check server/.env (DB_SERVER, DB_USER, DB_PASSWORD); for a new database run npm run db:init.');
  }
});
