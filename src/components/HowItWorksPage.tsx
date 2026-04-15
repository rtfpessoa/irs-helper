import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import markdownContent from '../../how_it_works.md?raw';

export const HowItWorksPage = () => {
  const { t } = useTranslation();

  return (
    <div className="how-it-works">
      <Link to="/" className="back-link">
        <ArrowLeft size={20} />
        {t('app.navigation.back')}
      </Link>
      
      <div className="glass-panel">
        <div className="markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {markdownContent}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
};
