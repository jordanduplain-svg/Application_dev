import DOMPurify from 'dompurify';
import type { Application } from '@candio/shared';
import { toHtmlRenderer } from '../lib/campaignDetail';

/**
 * FM-07 : modale d'aperçu HTML d'un email généré. Extraite de CampaignDetailPage
 * (REFACTO #22). Présentationnel pur : reçoit la candidature + onClose.
 */
export default function EmailPreviewModal({ app, onClose }: { app: Application; onClose: () => void }) {
  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <h3>Aperçu email — {app.companyName}</h3>
        <p style={{ fontSize: '12px', color: '#888' }}>Objet : {app.subject}</p>
        <div
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(toHtmlRenderer(app.body)) }}
          style={{
            background: '#fff', padding: '16px', borderRadius: '4px', border: '1px solid #e0e0e0',
            maxHeight: '500px', overflow: 'auto', fontFamily: 'Georgia, serif',
            fontSize: '14px', lineHeight: '1.6', color: '#222',
          }}
        />
        <div style={{ marginTop: '12px' }}>
          <button onClick={onClose}>Fermer</button>
        </div>
      </div>
    </>
  );
}
