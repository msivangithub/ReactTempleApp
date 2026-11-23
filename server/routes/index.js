// All API routes. Data lives in MSSQL only (see db.js); the old in-memory JSON store is gone.
import { Router } from 'express';
import auth from './auth.js';
import masters from './masters.js';
import bookings from './bookings.js';
import admin from './admin.js';
import { withUserNames } from './common.js';

const router = Router();
// Any JSON reply that carries CreatedBy / UpdatedBy / CancelledBy user ids also gets CreatedByName / UpdatedByName /
// CancelledByName, so every screen can show who created or last changed a record (one small Users query per reply).
router.use((req, res, next) => {
  const send = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 || !body || typeof body !== 'object') return send(body);
    withUserNames(body).then(() => send(body), () => send(body));
    return res;
  };
  next();
});
router.use(auth);
router.use(masters);
router.use(bookings);
router.use(admin);
export default router;
