import { useEffect, useState } from "react";

// WXT storage — prefijo "local:" = chrome.storage.local, sin instalaciones extras
const blockedCompaniesKey = "local:blocked_companies";
const blockedKeywordsKey = "local:blocked_keywords";
const hiddenCountKey = "local:workser_hidden_count";

type StorageItem<T> = ReturnType<typeof storage.defineItem<T>>;

const companiesStorage = storage.defineItem<string[]>(blockedCompaniesKey, { defaultValue: [] });
const keywordsStorage  = storage.defineItem<string[]>(blockedKeywordsKey,  { defaultValue: [] });
const counterStorage   = storage.defineItem<number>(hiddenCountKey,        { defaultValue: 0   });

export default function App() {
  const [companies, setCompanies] = useState<string[]>([]);
  const [keywords,  setKeywords]  = useState<string[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [activeTab, setActiveTab] = useState<"companies" | "keywords">("companies");
  const [inputValue, setInputValue] = useState("");

  // Cargar datos iniciales y suscribirse a cambios en tiempo real
  useEffect(() => {
    companiesStorage.getValue().then(setCompanies);
    keywordsStorage.getValue().then(setKeywords);
    counterStorage.getValue().then(setHiddenCount);

    const unsubCompanies = companiesStorage.watch((val) => setCompanies(val ?? []));
    const unsubKeywords  = keywordsStorage.watch((val)  => setKeywords(val ?? []));
    const unsubCounter   = counterStorage.watch((val)   => setHiddenCount(val ?? 0));

    return () => {
      unsubCompanies();
      unsubKeywords();
      unsubCounter();
    };
  }, []);

  const handleAdd = () => {
    const val = inputValue.trim();
    if (!val) return;

    if (activeTab === "companies") {
      if (!companies.includes(val)) {
        const updated = [...companies, val];
        setCompanies(updated);
        companiesStorage.setValue(updated);
      }
    } else {
      if (!keywords.includes(val)) {
        const updated = [...keywords, val];
        setKeywords(updated);
        keywordsStorage.setValue(updated);
      }
    }
    setInputValue("");
  };

  const handleRemove = (item: string) => {
    if (activeTab === "companies") {
      const updated = companies.filter(c => c !== item);
      setCompanies(updated);
      companiesStorage.setValue(updated);
    } else {
      const updated = keywords.filter(k => k !== item);
      setKeywords(updated);
      keywordsStorage.setValue(updated);
    }
  };

  const currentList = activeTab === "companies" ? companies : keywords;

  return (
    <div className="app-container">
      {/* ── Header ── */}
      <div className="header">
        <h1 className="app-title">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          Workser
        </h1>
        <div className="stats-card">
          <div className="stats-info">
            <h3>Trabajos Ocultos</h3>
            <p>{hiddenCount}</p>
          </div>
          <div className="pulse-circle" />
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === "companies" ? "active" : ""}`}
          onClick={() => setActiveTab("companies")}
        >
          Empresas
        </button>
        <button
          className={`tab ${activeTab === "keywords" ? "active" : ""}`}
          onClick={() => setActiveTab("keywords")}
        >
          Palabras Clave
        </button>
      </div>

      {/* ── Content ── */}
      <div className="content">
        <div className="input-group">
          <input
            type="text"
            placeholder={activeTab === "companies" ? "Ej. Empresa Spam SA" : "Ej. Call Center, Ventas"}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button onClick={handleAdd}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>

        {currentList.length === 0 ? (
          <div className="empty-state">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p>No hay filtros activos.</p>
          </div>
        ) : (
          <div>
            {currentList.map((item) => (
              <div className="list-item" key={item}>
                <span>{item}</span>
                <button className="btn-remove" onClick={() => handleRemove(item)} title="Eliminar">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="footer">
        <span>Workser Shield™ Active</span>
        <span>v0.0.1</span>
      </div>
    </div>
  );
}
