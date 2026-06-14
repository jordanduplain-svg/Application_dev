import { useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { Home, ChartBar, User, FileText, Send, Mail, ListChecks, Radar, Building2, Settings } from 'lucide-react';
import type { TaskProgress, ReplyNotification, SettingsStatus, SearchResult } from '@candio/shared';
import { api } from './lib/api';
import ProfilePage from './pages/ProfilePage';
import CvPage from './pages/CvPage';
import LeadsPage from './pages/LeadsPage';
import CampaignsPage from './pages/CampaignsPage';
import CampaignDetailPage from './pages/CampaignDetailPage';
import RepliesPage from './pages/RepliesPage';
import SettingsPage from './pages/SettingsPage';
import DashboardPage from './pages/DashboardPage';
import HomePage from './pages/HomePage';
import TodoPage from './pages/TodoPage';
import ScrapingPage from './pages/ScrapingPage';
import LockScreen from './components/LockScreen';

// Navigation maison. La sélection d'une campagne emporte l'id dans la route.
type Route =
  // DESIGN-2 : page d'accueil-lanceur (bento) — point d'entrée par défaut.
  | { name: 'home' }
  | { name: 'profile' }
  | { name: 'cv' }
  | { name: 'campaigns' }
  | { name: 'campaign'; id: string }
  | { name: 'replies' }
  | { name: 'settings' }
  | { name: 'stats' }
  // UX-5v3 : page des actions requises.
  | { name: 'todo' }
  // SCRAPE-01 : page de scraping.
  | { name: 'scraping' }
  // LEADS-VIEW : consultation des leads scrapés.
  | { name: 'leads' };

// M1 : garde les 100 dernières entrées du journal des tâches.
const MAX_LOG_ENTRIES = 100;

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' });
  // L3 : uid stable pour éviter l'antipattern key={index} quand le tableau est tronqué.
  const uidRef = useRef(0);
  const [taskLog, setTaskLog] = useState<(TaskProgress & { uid: number })[]>([]);
  // MOD-02 : les toasts reply:received et update:ready utilisent sonner — plus de state manuel.
  // ADM-1 : toast de mise à jour disponible (gardé pour éviter les doubles notifications).
  const updateReadyShownRef = useRef(false);

  // UX-8 : état de la checklist d'onboarding.
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus | null>(null);

  // UX-M16 : badge "À traiter".
  const [todoCount, setTodoCount] = useState(0);

  // SEC-M1 : verrouillage automatique.
  const [locked, setLocked] = useState(false);
  const lastActivityRef = useRef(Date.now());

  // UX-S20 : recherche globale.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // AUDIT-H4 fix : ref sur le conteneur pour détecter le clic extérieur.
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  // Charge le statut (verrouillage) + le badge « à traiter » au démarrage et à chaque route.
  useEffect(() => {
    const loadOnboarding = async () => {
      try {
        const [st, todoResult] = await Promise.all([
          api.invoke('settings:getStatus'),
          // UX-M16 : badge des actions requises.
          api.invoke('application:listActionRequired'),
        ]);
        setSettingsStatus(st);
        setTodoCount(todoResult.length);
      } catch { /* non bloquant */ }
    };
    void loadOnboarding();
  }, [route.name]);

  // H3 : demander la permission pour les notifications natives au démarrage.
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  // Journal global des tâches de fond (affiché en bas de la sidebar).
  useEffect(() => {
    return api.on('task:progress', (progress) => {
      // M1 : historique étendu à 100 lignes.
      setTaskLog((prev) => [...prev.slice(-(MAX_LOG_ENTRIES - 1)), { ...progress, uid: uidRef.current++ }]);
      // UX-M16 : rafraîchir le badge quand une tâche se termine.
      if (progress.status !== 'running') {
        api.invoke('application:listActionRequired')
          .then((r) => setTodoCount(r.length))
          .catch(() => {});
      }
    });
  }, []);

  // MOD-02 : Notification de réponse reçue via sonner toast + native notification.
  useEffect(() => {
    return api.on('reply:received', (data) => {
      toast.success(`Réponse reçue de ${data.companyName}`, {
        description: `${data.applicantName} — nouvelle réponse`,
        duration: 5000,
      });
      if ('Notification' in window && Notification.permission === 'granted') {
        // FM5 : clic sur notification native → naviguer vers la page Réponses.
        const notif = new Notification(`Réponse reçue de ${data.companyName}`, {
          body: `${data.applicantName} — nouvelle réponse`,
        });
        notif.onclick = () => {
          window.focus();
          setRoute({ name: 'replies' });
        };
      }
    });
  }, []);

  // BOUNCE-01 : toast quand un bounce est détecté.
  useEffect(() => {
    return api.on('bounce:detected', (data) => {
      toast.warning(`Email rebondi — ${data.companyName}`, {
        description: data.nextEmailAvailable
          ? 'Un email alternatif est disponible — cliquez sur "↻ Essayer" dans la campagne.'
          : 'Aucun email alternatif disponible — vérifiez manuellement.',
        duration: 8000,
      });
    });
  }, []);

  // MOD-02 : ADM-1 + ADM-3v3 : toast de mise à jour via sonner.
  useEffect(() => {
    return api.on('update:ready', (data) => {
      if (updateReadyShownRef.current) return;
      updateReadyShownRef.current = true;
      const version = data?.version ? ` — v${data.version}` : '';
      toast(`Mise à jour disponible${version} — relancez l'app`, {
        description: data?.releaseNotes
          ? (typeof data.releaseNotes === 'string' ? data.releaseNotes : JSON.stringify(data.releaseNotes))
          : undefined,
        duration: Infinity,
      });
    });
  }, []);

  // SEC-M1 : mise à jour de l'activité à chaque interaction.
  useEffect(() => {
    const update = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener('mousemove', update);
    window.addEventListener('keydown', update);
    return () => {
      window.removeEventListener('mousemove', update);
      window.removeEventListener('keydown', update);
    };
  }, []);

  // SEC-M1 : vérification toutes les 30s si l'app doit se verrouiller.
  useEffect(() => {
    const id = setInterval(() => {
      if (!settingsStatus?.lockEnabled) return;
      const timeout = (settingsStatus.lockTimeoutMinutes ?? 15) * 60_000;
      if (Date.now() - lastActivityRef.current > timeout) {
        setLocked(true);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [settingsStatus?.lockEnabled, settingsStatus?.lockTimeoutMinutes]);

  // UX-N17 : raccourcis clavier globaux.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === '1') { setRoute({ name: 'stats' }); e.preventDefault(); }
      else if (e.key === '2') { setRoute({ name: 'profile' }); e.preventDefault(); }
      else if (e.key === '3') { setRoute({ name: 'campaigns' }); e.preventDefault(); }
      else if (e.key === '4') { setRoute({ name: 'replies' }); e.preventDefault(); }
      else if (e.key === '5') { setRoute({ name: 'todo' }); e.preventDefault(); }
      else if (e.key === '6') { setRoute({ name: 'settings' }); e.preventDefault(); }
      else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (route.name !== 'replies') {
          setRoute({ name: 'replies' });
        } else {
          api.invoke('replies:pollNow').catch(() => {});
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [route.name]);

  // UX-S20 : debounce de la recherche globale (300ms).
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (searchQuery.length < 2) { setSearchResults([]); setShowSearch(false); return; }
    searchDebounceRef.current = setTimeout(() => {
      api.invoke('search:global', { query: searchQuery })
        .then((r) => { setSearchResults(r); setShowSearch(true); })
        .catch(() => {});
    }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery]);

  // Fermer le dropdown de recherche sur Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // AUDIT-H4 fix : fermer le dropdown sur clic en dehors du conteneur de recherche.
  useEffect(() => {
    if (!showSearch) return;
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSearch]);

  const isCampaignsActive = route.name === 'campaigns' || route.name === 'campaign';
  // ANA-3v3 : navigation depuis le dashboard vers une campagne spécifique.
  const openCampaign = (id: string) => setRoute({ name: 'campaign', id });

  // Gérer le clic sur un résultat de recherche.
  const handleSearchResultClick = (result: SearchResult) => {
    setShowSearch(false);
    setSearchQuery('');
    if (result.type === 'campaign') {
      setRoute({ name: 'campaign', id: result.id });
    } else if (result.type === 'company') {
      setRoute({ name: 'campaign', id: result.campaignId! });
    } else if (result.type === 'application') {
      setRoute({ name: 'campaign', id: result.campaignId! });
    }
  };

  // ADM-M1 : compteur de tâches en cours dans la sidebar.
  const runningTasks = taskLog.filter((t) => t.status === 'running');

  return (
    <>
      {/* MOD-02 : Toaster sonner — HORS du grid pour ne pas décaler sidebar/content. */}
      <Toaster position="top-right" richColors />

      {/* SEC-M1 : écran de verrouillage (position:fixed, hors du grid). */}
      {locked && settingsStatus?.lockEnabled && (
        <LockScreen onUnlock={() => setLocked(false)} />
      )}

    <div className="app">
      <nav className="sidebar">
        <h1>Candidatures</h1>

        {/* UX-S20 : barre de recherche globale. */}
        {/* AUDIT-H4 fix : ref pour la détection du clic extérieur. */}
        <div ref={searchContainerRef} style={{ position: 'relative', marginBottom: '8px' }}>
          <input
            type="search"
            placeholder="Rechercher…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowSearch(true)}
            style={{ width: '100%', fontSize: '13px', padding: '6px 8px', boxSizing: 'border-box' }}
          />
          {/* Dropdown des résultats de recherche. */}
          {showSearch && searchResults.length > 0 && (
            // BUG-F1 fix : key stable = type+id, pas l'index du tableau.
            <div className="search-dropdown" onMouseDown={(e) => e.preventDefault()}>
              {searchResults.map((r) => (
                <div
                  key={`${r.type}-${r.id}`}
                  className="search-item"
                  onClick={() => handleSearchResultClick(r)}
                >
                  <div className="search-item-label">{r.label}</div>
                  {r.sublabel && <div className="search-item-sub">{r.sublabel}</div>}
                  <div className="search-item-type">{r.type}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ADM-M1 : mini compteur des tâches en cours. */}
        {runningTasks.length > 0 && (
          <div className="sidebar-task-badge">
            ⟳ {runningTasks.length} tâche{runningTasks.length > 1 ? 's' : ''} en cours
          </div>
        )}

        {/* DESIGN-2 : nav colorée — chaque item porte sa couleur de section (--nav). */}
        <button onClick={() => setRoute({ name: 'home' })} className={route.name === 'home' ? 'active' : ''} style={{ '--nav': '#0a84ff' } as React.CSSProperties}>
          <Home size={17} className="nav-ico" /> <span>Accueil</span>
        </button>
        <button onClick={() => setRoute({ name: 'stats' })} className={route.name === 'stats' ? 'active' : ''} style={{ '--nav': '#7F77DD' } as React.CSSProperties}>
          <ChartBar size={17} className="nav-ico" /> <span>Tableau de bord</span>
        </button>
        <button onClick={() => setRoute({ name: 'campaigns' })} className={isCampaignsActive ? 'active' : ''} style={{ '--nav': '#5856d6' } as React.CSSProperties}>
          <Send size={17} className="nav-ico" /> <span>Campagnes</span>
        </button>
        <button onClick={() => setRoute({ name: 'replies' })} className={route.name === 'replies' ? 'active' : ''} style={{ '--nav': '#1D9E75' } as React.CSSProperties}>
          <Mail size={17} className="nav-ico" /> <span>Réponses</span>
        </button>
        {/* UX-5v3 : page des actions requises avec badge. */}
        <button onClick={() => setRoute({ name: 'todo' })} className={route.name === 'todo' ? 'active' : ''} style={{ '--nav': '#BA7517', ...(todoCount > 0 ? { fontWeight: 600 } : {}) } as React.CSSProperties}>
          <ListChecks size={17} className="nav-ico" /> <span>À traiter{todoCount > 0 ? ` (${todoCount})` : ''}</span>
        </button>
        {/* SCRAPE-01 : scraping d'entreprises. */}
        <button onClick={() => setRoute({ name: 'scraping' })} className={route.name === 'scraping' ? 'active' : ''} style={{ '--nav': '#D85A30' } as React.CSSProperties}>
          <Radar size={17} className="nav-ico" /> <span>Scraping</span>
        </button>
        {/* LEADS-VIEW : consultation des leads scrapés. */}
        <button onClick={() => setRoute({ name: 'leads' })} className={route.name === 'leads' ? 'active' : ''} style={{ '--nav': '#378ADD' } as React.CSSProperties}>
          <Building2 size={17} className="nav-ico" /> <span>Leads</span>
        </button>
        <button onClick={() => setRoute({ name: 'cv' })} className={route.name === 'cv' ? 'active' : ''} style={{ '--nav': '#8E8E93' } as React.CSSProperties}>
          <FileText size={17} className="nav-ico" /> <span>CV</span>
        </button>
        <button onClick={() => setRoute({ name: 'profile' })} className={route.name === 'profile' ? 'active' : ''} style={{ '--nav': '#8E8E93' } as React.CSSProperties}>
          <User size={17} className="nav-ico" /> <span>Profil</span>
        </button>
        <button onClick={() => setRoute({ name: 'settings' })} className={route.name === 'settings' ? 'active' : ''} style={{ '--nav': '#8E8E93' } as React.CSSProperties}>
          <Settings size={17} className="nav-ico" /> <span>Réglages</span>
        </button>

        {/* ADM-M1 : tâches en cours groupées en haut du log. */}
        <div className="task-log">
          {taskLog.filter((t) => t.status === 'running').map((t) => (
            <div key={t.uid} className="task-line task-running" style={{ fontWeight: 500 }}>
              ⟳ {t.message}
            </div>
          ))}
          {taskLog.filter((t) => t.status !== 'running').slice(-10).map((t) => (
            <div key={t.uid} className={`task-line task-${t.status}`}>
              {t.message}
            </div>
          ))}
        </div>
      </nav>

      <main className="content">
        {/* DESIGN-2 : toutes les cibles de HomePage sont des routes sans paramètre → cast sûr. */}
        {route.name === 'home' && <HomePage onNavigate={(n) => setRoute({ name: n } as Route)} />}
        {route.name === 'stats' && <DashboardPage onOpenCampaign={openCampaign} />}
        {route.name === 'profile' && (
          <ProfilePage
            onGoToCv={() => setRoute({ name: 'cv' })}
            onGoToSettings={() => setRoute({ name: 'settings' })}
            onGoToScraping={() => setRoute({ name: 'scraping' })}
          />
        )}
        {route.name === 'cv' && <CvPage />}
        {route.name === 'campaigns' && (
          <CampaignsPage
            onOpen={(id) => setRoute({ name: 'campaign', id })}
            onGoToSettings={() => setRoute({ name: 'settings' })}
            onGoToCv={() => setRoute({ name: 'cv' })}
          />
        )}
        {route.name === 'campaign' && (
          <CampaignDetailPage
            id={route.id}
            onBack={() => setRoute({ name: 'campaigns' })}
            onGoToSettings={() => setRoute({ name: 'settings' })}
          />
        )}
        {route.name === 'replies' && <RepliesPage />}
        {/* UX-5v3 : page des actions requises. */}
        {route.name === 'todo' && <TodoPage onOpenCampaign={openCampaign} />}
        {/* SCRAPE-01 : page de scraping. */}
        {route.name === 'scraping' && <ScrapingPage onGoToLeads={() => setRoute({ name: 'leads' })} />}
        {route.name === 'leads' && <LeadsPage onGoToScraping={() => setRoute({ name: 'scraping' })} />}
        {route.name === 'settings' && <SettingsPage />}
      </main>
    </div>
    </>
  );
}
