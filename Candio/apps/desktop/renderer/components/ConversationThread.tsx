import { useState } from 'react';
import DOMPurify from 'dompurify';
import type { Application } from '@candio/shared';

/**
 * UX-S5 : fil de conversation d'une candidature (email envoyé + relance + réponse).
 * Extrait de CampaignDetailPage (REFACTO #22). Composant présentationnel pur.
 */
export default function ConversationThread({ app }: { app: Application }) {
  const [showFullBody, setShowFullBody] = useState(false);
  const [showFullReply, setShowFullReply] = useState(false);
  const TRUNC = 500;

  const hasAnyThread = app.body || app.followUpSentAt || app.replyContent;
  if (!hasAnyThread) return null;

  return (
    <div style={{ marginTop: '16px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
      <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: '#555' }}>Fil de conversation</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

        {/* Email envoyé */}
        {app.body && (
          <div style={{ borderLeft: '3px solid #007aff', paddingLeft: '10px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#007aff', marginBottom: '4px' }}>
              Email envoyé{app.sentAt ? ` — ${new Date(app.sentAt).toLocaleDateString('fr-FR')}` : ''}
            </div>
            <div style={{ fontSize: '12px', color: '#444', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {showFullBody ? app.body : app.body.slice(0, TRUNC) + (app.body.length > TRUNC ? '…' : '')}
            </div>
            {app.body.length > TRUNC && (
              <button
                onClick={() => setShowFullBody((v) => !v)}
                style={{ fontSize: '11px', color: '#007aff', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
              >
                {showFullBody ? 'Réduire' : 'Voir tout'}
              </button>
            )}
          </div>
        )}

        {/* Relance envoyée */}
        {app.followUpSentAt && (
          <div style={{ borderLeft: '3px solid #ff9f0a', paddingLeft: '10px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#ff9f0a' }}>
              Relance envoyée le {new Date(app.followUpSentAt).toLocaleDateString('fr-FR')}
            </div>
          </div>
        )}

        {/* Réponse reçue */}
        {app.replyContent && (
          <div style={{ borderLeft: '3px solid #34c759', paddingLeft: '10px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#34c759', marginBottom: '4px' }}>
              Réponse reçue{app.repliedAt ? ` le ${new Date(app.repliedAt).toLocaleDateString('fr-FR')}` : ''}
            </div>
            {/* Sanitiser le HTML si présent. */}
            {/<[a-z][\s\S]*>/i.test(app.replyContent) ? (
              <div
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(showFullReply ? app.replyContent : app.replyContent.slice(0, TRUNC)) }}
                style={{ fontSize: '12px', color: '#444', wordBreak: 'break-word' }}
              />
            ) : (
              <div style={{ fontSize: '12px', color: '#444', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {showFullReply ? app.replyContent : app.replyContent.slice(0, TRUNC) + (app.replyContent.length > TRUNC ? '…' : '')}
              </div>
            )}
            {app.replyContent.length > TRUNC && (
              <button
                onClick={() => setShowFullReply((v) => !v)}
                style={{ fontSize: '11px', color: '#34c759', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
              >
                {showFullReply ? 'Réduire' : 'Voir tout'}
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
