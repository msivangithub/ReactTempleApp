import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Landmark, MapPin, Phone, RefreshCw, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Field } from '../components/ui.jsx';

export default function Login() {
  const { config, configError, reloadConfig, login, loading, sessionMessage, lastLocationId } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const locations = config?.locations || [];

  useEffect(() => { reloadConfig(); }, [reloadConfig]);
  useEffect(() => { if (config?.appName) document.title = config.appName; }, [config?.appName]);

  // Preselect the last used location (if still active), else the first active one
  useEffect(() => {
    if (!locations.length) return;
    if (!locations.some((l) => String(l.LocationId) === String(locationId))) {
      const last = locations.find((l) => String(l.LocationId) === String(lastLocationId));
      setLocationId(String((last || locations[0]).LocationId));
    }
  }, [locations]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(
    () => locations.find((l) => String(l.LocationId) === String(locationId)),
    [locations, locationId]
  );

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!locationId) return setError('Please select a location');
    try {
      await login(username.trim(), password, locationId);
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <div className="hero-brand">
          {config?.brandIconUrl ? (
            <img className="brand-logo-mark" src={config.brandIconUrl} alt="" />
          ) : (
            <div className="brand-mark"><Landmark size={18} /></div>
          )}
          <b>{(config?.appName || '').toUpperCase()}</b>
        </div>

        {selected ? (
          <div className="hero-loc" key={selected.LocationId}>
            <div className="hero-eyebrow">
              {selected.LocationCode ? `${selected.LocationCode} · ` : ''}Selected location
            </div>
            <h1>{selected.LocationName}</h1>
            {selected.Description && <p>{selected.Description}</p>}
            <div className="hero-meta">
              {selected.Address && <span><MapPin size={13} />{selected.Address}</span>}
              {selected.Phone && <span><Phone size={13} />{selected.Phone}</span>}
            </div>
            {selected.Temples?.length > 0 && (
              <>
                <div className="hero-eyebrow" style={{ marginTop: 18 }}>
                  {selected.Temples.length} {selected.Temples.length === 1 ? 'temple' : 'temples'} at this location
                </div>
                <div className="temple-chips">
                  {selected.Temples.map((t) => <span key={t}>{t}</span>)}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="hero-loc">
            <h1>{config?.appName}</h1>
            <p>{config?.tagline}</p>
          </div>
        )}
      </div>

      <div className="login-form">
        <form className="login-card" onSubmit={submit}>
          {config?.brandLogoUrl && (
            <img className="login-logo" src={config.brandLogoUrl} alt={config.brandName || ''} />
          )}
          <h2>Sign in</h2>
          <p>Enter your credentials and select your working location.</p>

          {(sessionMessage || error || configError) && (
            <div className="alert">
              {error || sessionMessage || `Unable to load locations: ${configError}`}
            </div>
          )}

          <div style={{ display: 'grid', gap: 10 }}>
            <Field label="Username" required>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                placeholder="Enter username"
              />
            </Field>

            <Field label="Password" required>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </Field>

            <div>
              <div className="field-label-row" style={{ marginBottom: 4 }}>
                <span>Location <i>*</i></span>
                {configError && (
                  <button type="button" className="link-btn" onClick={reloadConfig}>
                    <RefreshCw size={11} /> Retry
                  </button>
                )}
              </div>

              {locations.length ? (
                <select
                  className="input"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  required
                >
                  {locations.map((l) => (
                    <option key={l.LocationId} value={l.LocationId}>
                      {l.LocationName}{l.LocationCode ? ` (${l.LocationCode})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="alert subtle">
                  No active locations configured yet. Contact your administrator.
                </div>
              )}
            </div>
          </div>

          <button
            className="btn btn-primary btn-block"
            disabled={loading || !locations.length}
          >
            <LogIn size={15} />
            {loading ? 'Signing in…' : selected ? `Sign in to ${selected.LocationName}` : 'Sign in'}
          </button>

          <p className="login-foot">Access is granted per user and per location by your administrator.</p>
        </form>
      </div>
    </div>
  );
}