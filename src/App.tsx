import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route } from 'react-router-dom';
import { HomePage } from './components/HomePage';
import { HowItWorksPage } from './components/HowItWorksPage';
import { Languages, Sun, Moon } from 'lucide-react';
import { FaGithub } from 'react-icons/fa';
import { Analytics } from '@vercel/analytics/react';

function App() {
  const { t, i18n } = useTranslation();
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('irs-helper-theme');
    if (stored) return stored === 'dark';
    return false; // Default to light
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

      <footer className="app-footer">
        <a
          href="https://github.com/almeiduh/irs-helper"
          target="_blank"
          rel="noopener noreferrer"
          className="app-footer__link"
          aria-label="GitHub repository"
        >
          <FaGithub size={16} aria-hidden="true" />
          <span>GitHub Repository</span>
        </a>
        <span className="app-footer__author">Diogo Almeida</span>
      </footer>
      <Analytics />
    </div>
  );
}

export default App;
