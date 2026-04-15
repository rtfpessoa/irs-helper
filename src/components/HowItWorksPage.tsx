import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import markdownContentEn from '../../how_it_works.md?raw';
import markdownContentPt from '../../how_it_works_pt.md?raw';

/** Renders the localized markdown guide that explains the enrichment workflow. */
export const HowItWorksPage = () => {
  const { t, i18n } = useTranslation();
  const markdownContent = i18n.language?.startsWith('en')
    ? markdownContentEn
    : markdownContentPt;

  return (
    <div className="how-it-works">
      <Link to="/" className="back-link">
        <ArrowLeft size={20} />
        {t('app.navigation.back')}
      </Link>
      
      <div className="glass-panel">
        <div className="markdown-content">
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            disallowedElements={['script', 'style', 'iframe', 'object', 'embed']}
            unwrapDisallowed={true}
          >
            {markdownContent}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
};
