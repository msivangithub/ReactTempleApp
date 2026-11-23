import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { BookingRoute, AdvanceBookingRoute } from './pages/Booking.jsx';
import BookingsPage from './pages/Bookings.jsx';
import MembersPage from './pages/Members.jsx';
import ReportsPage from './pages/Reports.jsx';
import UsersPage from './pages/Users.jsx';
import RolesPage from './pages/Roles.jsx';
import { get } from './api.js';
import { LocationsPage, TemplesPage, DeitiesPage, CategoriesPage, CountersPage, SevasPage, ItemsPage, BookingTypesPage, PaymentModesPage, BookingStatusesPage, MemberFrequenciesPage, MemberStatusesPage, TimeSlotsPage } from './pages/Masters.jsx';

export function AccessDenied() {
  return <div className="card card-body" style={{ marginTop: 20 }}><b>Access denied</b><p className="muted" style={{ marginTop: 6 }}>Your role does not have permission for this screen. Contact your administrator.</p></div>;
}

function Protected({ children, screen }) {
  const { user, location, can } = useAuth();
  if (!user || !location) return <Navigate to="/login" replace />;
  if (screen && !can(screen, 'CanView')) return <AccessDenied />;
  return children;
}

// Legacy /booking → first booking type this user can use
function DefaultBooking() {
  const { can } = useAuth();
  const [target, setTarget] = useState(null);
  useEffect(() => { get('/booking-types?activeOnly=true').then((t) => { const first = t.find((x) => x.IsDefault && can(x.ScreenKey)) || t.find((x) => can(x.ScreenKey)); setTarget(first ? `/book/${first.BookingTypeId}` : '/'); }).catch(() => setTarget('/')); }, []); // eslint-disable-line
  return target ? <Navigate to={target} replace /> : null;
}

const PAGES = [
  ['bookings', 'bookings', BookingsPage], ['members', 'lifetime_members', MembersPage], ['reports', 'reports', ReportsPage],
  ['locations', 'locations', LocationsPage], ['temples', 'temple_mgmt', TemplesPage], ['deities', 'deity_mgmt', DeitiesPage],
  ['sevas', 'seva_master', SevasPage], ['items', 'item_master', ItemsPage], ['categories', 'seva_categories', CategoriesPage],
  ['counters', 'counters', CountersPage], ['users', 'user_mgmt', UsersPage], ['roles', 'screen_allocation', RolesPage],
  ['booking-types', 'booking_types', BookingTypesPage], ['payment-modes', 'payment_modes', PaymentModesPage], ['booking-statuses', 'booking_statuses', BookingStatusesPage],
  ['time-slots', 'time_slots', TimeSlotsPage], ['member-frequencies', 'member_frequencies', MemberFrequenciesPage], ['member-statuses', 'member_statuses', MemberStatusesPage],
];

export default function App() {
  const { user, location } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user && location ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Protected screen="overview"><Dashboard /></Protected>} />
        {/* Each booking type (Seva, Laddu, Goshala, …) has its own screen; permission is checked inside against the type's ScreenKey */}
        <Route path="book/:typeId" element={<BookingRoute />} />
        <Route path="advance" element={<Protected screen="advance_booking"><AdvanceBookingRoute /></Protected>} />
        <Route path="booking" element={<DefaultBooking />} />
        {PAGES.map(([path, screen, Page]) => <Route key={path} path={path} element={<Protected screen={screen}><Page /></Protected>} />)}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
