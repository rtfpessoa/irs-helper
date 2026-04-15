import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, Link } from 'react-router-dom';
import { HomePage } from './components/HomePage';
import { HowItWorksPage } from './components/HowItWorksPage';
import { Languages, Info, Sun, Moon } from 'lucide-react';

function App() {
  const { t, i18n } = useTranslation();
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('irs-helper-theme');
    if (stored) return stored === 'dark';
    return true; // Default to dark
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('irs-helper-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggleTheme = () => setIsDark(prev => !prev);

  return (
    <div className="app-container">
      <header className="header">
        <div className="header__main">
          <h1 className="title">{t('app.title')}</h1>
          <p className="subtitle">{t('app.subtitle')}</p>
        </div>
        <div className="header__actions">
          <Link to="/how-it-works" className="nav-button">
            <Info size={18} />
            {t('app.how_it_works')}
          </Link>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="language-selector">
            <div className="language-selector__icon">
              <Languages size={18} />
            </div>
            <select 
              value={i18n.language} 
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="language-selector__select"
            >
              <option value="en">{t('languages.en')}</option>
              <option value="pt">{t('languages.pt')}</option>
            </select>
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
      </Routes>
    </div>
  );
}

export default App;
