import { useState, useMemo } from 'react';
import { GitCompare, ChevronDown, ChevronUp, Columns, AlignJustify } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DiffViewerProps {
  originalXml: string;
  enrichedXml: string;
}

type DiffLine =
  | { type: 'context'; text: string; lineOld: number; lineNew: number }
  | { type: 'added'; text: string; lineNew: number }
  | { type: 'removed'; text: string; lineOld: number };

type SplitDiffRow = 
  | { type: 'context'; left: DiffLine; right: DiffLine }
  | { type: 'added'; right: DiffLine }
  | { type: 'removed'; left: DiffLine }
  | { type: 'modified'; left: DiffLine; right: DiffLine }
  | { type: 'separator'; count: number };

/** Very lightweight Myers-like line diff for XML text.
 *  Within each changed hunk, all removals are emitted before additions
 *  so that computeSplitDiff can align them properly side-by-side. */
function computeDiff(original: string, enriched: string): DiffLine[] {
  const oldLines = original.split('\n');
  const newLines = enriched.split('\n');

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  const newLineMap = new Map<string, number[]>();
  newLines.forEach((line, idx) => {
    const existing = newLineMap.get(line) ?? [];
    existing.push(idx);
    newLineMap.set(line, existing);
  });

  const oldLineMap = new Map<string, number[]>();
  oldLines.forEach((line, idx) => {
    const ex = oldLineMap.get(line) ?? [];
    ex.push(idx);
    oldLineMap.set(line, ex);
  });

  while (i < oldLines.length || j < newLines.length) {
    if (i >= oldLines.length) {
      result.push({ type: 'added', text: newLines[j], lineNew: newLineNum });
      j++;
      newLineNum++;
    } else if (j >= newLines.length) {
      result.push({ type: 'removed', text: oldLines[i], lineOld: oldLineNum });
      i++;
      oldLineNum++;
    } else if (oldLines[i] === newLines[j]) {
      result.push({ type: 'context', text: oldLines[i], lineOld: oldLineNum, lineNew: newLineNum });
      i++;
      j++;
      oldLineNum++;
      newLineNum++;
    } else {
      // Collect the entire changed hunk: find where old and new re-synchronize
      const removedBuf: DiffLine[] = [];
      const addedBuf: DiffLine[] = [];

      while (i < oldLines.length && j < newLines.length && oldLines[i] !== newLines[j]) {
        const posInNew = (newLineMap.get(oldLines[i]) ?? []).find(p => p >= j);
        const posInOld = (oldLineMap.get(newLines[j]) ?? []).find(p => p >= i);

        const skipNew = posInNew !== undefined ? posInNew - j : Infinity;
        const skipOld = posInOld !== undefined ? posInOld - i : Infinity;

        if (skipNew === Infinity && skipOld === Infinity) {
          removedBuf.push({ type: 'removed', text: oldLines[i], lineOld: oldLineNum });
          addedBuf.push({ type: 'added', text: newLines[j], lineNew: newLineNum });
          i++;
          j++;
          oldLineNum++;
          newLineNum++;
        } else if (skipOld <= skipNew) {
          removedBuf.push({ type: 'removed', text: oldLines[i], lineOld: oldLineNum });
          i++;
          oldLineNum++;
        } else {
          addedBuf.push({ type: 'added', text: newLines[j], lineNew: newLineNum });
          j++;
          newLineNum++;
        }
      }

      // Emit all removals first, then all additions — keeps them grouped
      result.push(...removedBuf, ...addedBuf);
    }
  }

  return result;
}

/** Group consecutive additions/removals into side-by-side rows */
function computeSplitDiff(diff: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let i = 0;
  while (i < diff.length) {
    const line = diff[i];
    if (line.type === 'context') {
      rows.push({ type: 'context', left: line, right: line });
      i++;
    } else if (line.type === 'removed') {
      // Look ahead for a matching 'added' line to pair
      let j = i + 1;
      while (j < diff.length && diff[j].type === 'removed') j++;
      
      const removedGroup = diff.slice(i, j);
      const addedStart = j;
      while (j < diff.length && diff[j].type === 'added') j++;
      const addedGroup = diff.slice(addedStart, j);

      const max = Math.max(removedGroup.length, addedGroup.length);
      for (let k = 0; k < max; k++) {
        const l = removedGroup[k];
        const r = addedGroup[k];
        if (l && r) rows.push({ type: 'modified', left: l, right: r });
        else if (l) rows.push({ type: 'removed', left: l });
        else if (r) rows.push({ type: 'added', right: r });
      }
      i = j;
    } else {
      // Just added (without preceding removals)
      rows.push({ type: 'added', right: line });
      i++;
    }
  }
  return rows;
}

/** Collapse consecutive context lines into hunks */
function buildHunks<T extends { type: string }>(diff: T[], contextRadius = 3): (T | { type: 'separator'; count: number })[] {
  const CHANGED = new Set<number>();
  diff.forEach((line, idx) => {
    if (line.type !== 'context') CHANGED.add(idx);
  });

  const visible = new Set<number>();
  CHANGED.forEach(idx => {
    for (let k = Math.max(0, idx - contextRadius); k <= Math.min(diff.length - 1, idx + contextRadius); k++) {
      visible.add(k);
    }
  });

  const out: (T | { type: 'separator'; count: number })[] = [];
  let prevVisible = -1;

  diff.forEach((line, idx) => {
    if (!visible.has(idx)) return;
    const gap = idx - prevVisible - 1;
    if (gap > 0 && prevVisible !== -1) {
      out.push({ type: 'separator', count: gap });
    }
    out.push(line);
    prevVisible = idx;
  });

  return out;
}

/** Render a diff line as plain text (avoids dangerouslySetInnerHTML corruption) */
function renderLineText(text: string, type: string): React.ReactNode {
  const className = `diff-line__text diff-line__text--${type}`;
  return <span className={className}>{text}</span>;
}

export function DiffViewer({ originalXml, enrichedXml }: DiffViewerProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('unified');

  const allDiffUnified = useMemo(() => computeDiff(originalXml, enrichedXml), [originalXml, enrichedXml]);
  const allDiffSplit = useMemo(() => computeSplitDiff(allDiffUnified), [allDiffUnified]);

  const displayDiffUnified = useMemo(() => (showAll ? allDiffUnified : buildHunks(allDiffUnified)), [allDiffUnified, showAll]);
  const displayDiffSplit = useMemo(() => (showAll ? allDiffSplit : buildHunks(allDiffSplit)), [allDiffSplit, showAll]);

  const addedCount = allDiffUnified.filter(l => l.type === 'added').length;
  const removedCount = allDiffUnified.filter(l => l.type === 'removed').length;

  return (
    <div className={`diff-viewer diff-viewer--${viewMode}`}>
      <button className="diff-viewer__toggle" onClick={() => setIsExpanded(v => !v)}>
        <GitCompare size={18} />
        <span>{t('diff.title')}</span>
        <span className="diff-viewer__stats">
          <span className="diff-stat diff-stat--added">+{addedCount}</span>
          <span className="diff-stat diff-stat--removed">−{removedCount}</span>
        </span>
        {isExpanded ? <ChevronUp size={16} className="diff-viewer__chevron" /> : <ChevronDown size={16} className="diff-viewer__chevron" />}
      </button>

      {isExpanded && (
        <div className="diff-viewer__body">
          <div className="diff-viewer__file-bar">
            <div className="diff-viewer__mode-toggles">
              <button 
                className={`diff-viewer__mode-btn ${viewMode === 'unified' ? 'active' : ''}`}
                onClick={() => setViewMode('unified')}
                title={t('diff.unified')}
              >
                <AlignJustify size={14} /> {t('diff.unified')}
              </button>
              <button 
                className={`diff-viewer__mode-btn ${viewMode === 'split' ? 'active' : ''}`}
                onClick={() => setViewMode('split')}
                title={t('diff.split')}
              >
                <Columns size={14} /> {t('diff.split')}
              </button>
            </div>

            <span className="diff-viewer__filename">declaracao-enriched.xml</span>

            <button className="diff-viewer__show-all-btn" onClick={() => setShowAll(v => !v)}>
              {showAll ? t('diff.collapse') : t('diff.show_full')}
            </button>
          </div>

          <div className="diff-viewer__code">
            {viewMode === 'unified' ? (
              displayDiffUnified.map((entry, idx) => {
                if (entry.type === 'separator') {
                  const label = entry.count !== 1 ? t('diff.unchanged_lines_plural', { count: entry.count }) : t('diff.unchanged_lines', { count: entry.count });
                  return (
                    <div key={idx} className="diff-line diff-line--separator">
                      <span className="diff-line__gutter" />
                      <span className="diff-line__gutter" />
                      <span className="diff-line__marker" />
                      <span className="diff-line__text--separator">
                        ·· {label} ··
                      </span>
                    </div>
                  );
                }
                const line = entry as DiffLine;
                const isAdded = line.type === 'added';
                const isRemoved = line.type === 'removed';
                const oldLineNumber = line.type === 'added' ? '' : line.lineOld;
                const newLineNumber = line.type === 'removed' ? '' : line.lineNew;
                
                return (
                  <div key={idx} className={`diff-line diff-line--${line.type}`}>
                    <span className="diff-line__gutter">{oldLineNumber}</span>
                    <span className="diff-line__gutter">{newLineNumber}</span>
                    <span className="diff-line__marker">{isAdded ? '+' : isRemoved ? '-' : ''}</span>
                    {renderLineText(line.text, line.type)}
                  </div>
                );
              })
            ) : (
              displayDiffSplit.map((entry, idx) => {
                if (entry.type === 'separator') {
                  const label = t('diff.unchanged_lines_plural', { count: entry.count });
                  return (
                    <div key={idx} className="diff-split-row diff-split-row--separator">
                      <div className="diff-split-side">·· {label} ··</div>
                      <div className="diff-split-side">·· {label} ··</div>
                    </div>
                  );
                }
                const row = entry as SplitDiffRow;
                const left = 'left' in row ? row.left : undefined;
                const right = 'right' in row ? row.right : undefined;
                const leftLineNumber = left ? (left.type === 'added' ? '' : left.lineOld) : '';
                const rightLineNumber = right ? (right.type === 'removed' ? '' : right.lineNew) : '';

                return (
                  <div key={idx} className={`diff-split-row diff-split-row--${row.type}`}>
                    {/* Left Column */}
                    <div className={`diff-split-side diff-split-side--left ${left ? `diff-line--${left.type}` : 'diff-line--empty'}`}>
                      <span className="diff-line__gutter">{leftLineNumber}</span>
                      <span className="diff-line__marker">{left?.type === 'removed' ? '-' : ''}</span>
                      {left ? renderLineText(left.text, left.type) : <span className="diff-line__text"></span>}
                    </div>
                    {/* Right Column */}
                    <div className={`diff-split-side diff-split-side--right ${right ? `diff-line--${right.type}` : 'diff-line--empty'}`}>
                      <span className="diff-line__gutter">{rightLineNumber}</span>
                      <span className="diff-line__marker">{right?.type === 'added' ? '+' : ''}</span>
                      {right ? renderLineText(right.text, right.type) : <span className="diff-line__text"></span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
