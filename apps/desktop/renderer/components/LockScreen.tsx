import { useState } from 'react';
import { api } from '../lib/api';

// SEC-M1 : écran de verrouillage automatique.
//
// ROUAGE : recouvre toute l'app après inactivité. La vérification du PIN se fait CÔTÉ MAIN
// (`settings:verifyPin`) — le renderer ne connaît jamais le hash ; il n'envoie que la saisie
// et reçoit un booléen. `onUnlock()` ne lève l'écran que sur réponse positive.
interface LockScreenProps {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const handleUnlock = async () => {
    if (!pin) return;
    setChecking(true);
    setError(null);
    try {
      const result = await api.invoke('settings:verifyLockPin', { pin });
      if (result.ok) {
        setPin('');
        onUnlock();
      } else {
        setError('PIN incorrect — réessayez.');
        setPin('');
      }
    } catch {
      setError('Erreur lors de la vérification.');
    } finally {
      setChecking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleUnlock();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0, 0, 0, 0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: '12px', padding: '32px',
        width: '320px', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '8px' }}>🔒</div>
        <h2 style={{ marginBottom: '8px', color: '#333' }}>Application verrouillée</h2>
        <p style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>
          Saisissez votre PIN pour déverrouiller.
        </p>
        <input
          type="password"
          placeholder="PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          style={{
            width: '100%', padding: '10px', fontSize: '16px',
            border: '1px solid #ccc', borderRadius: '6px',
            textAlign: 'center', letterSpacing: '4px', marginBottom: '12px',
            boxSizing: 'border-box',
          }}
        />
        {error && <p style={{ color: '#ff453a', fontSize: '13px', marginBottom: '8px' }}>{error}</p>}
        <button
          onClick={() => void handleUnlock()}
          disabled={!pin || checking}
          style={{
            width: '100%', padding: '10px', background: '#007aff', color: '#fff',
            border: 'none', borderRadius: '6px', fontSize: '15px', cursor: 'pointer',
          }}
        >
          {checking ? 'Vérification…' : 'Déverrouiller'}
        </button>
      </div>
    </div>
  );
}
