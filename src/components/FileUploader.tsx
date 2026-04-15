import React, { useCallback, useId, useState } from 'react';
import { UploadCloud, CheckCircle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

interface FileUploaderProps {
  label: string;
  accept: string;
  onFileSelect: (file: File) => void;
  onRemove?: () => void;
}

/** Generic drag-and-drop uploader for one file input. */
export function FileUploader({ label, accept, onFileSelect, onRemove }: FileUploaderProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const isAcceptedFile = useCallback((file: File) => {
    const normalizedAccept = accept.trim().toLowerCase();
    if (!normalizedAccept) {
      return true;
    }

    const extension = file.name.includes('.') ? `.${file.name.split('.').pop()?.toLowerCase()}` : '';
    return normalizedAccept.split(',').map(token => token.trim()).some(token => token === extension);
  }, [accept]);

  const handleFile = useCallback((file: File) => {
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return;
    }

    if (!isAcceptedFile(file)) {
      return;
    }

    setSelectedFile(file);
    onFileSelect(file);
  }, [isAcceptedFile, onFileSelect]);

  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFile(null);
    if (onRemove) onRemove();
  }, [onRemove]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      handleFile(file);
      e.dataTransfer.clearData();
    }
  }, [handleFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  }, [handleFile]);

  return (
    <div 
      className={`drop-zone ${isDragActive ? 'active' : ''} ${selectedFile ? 'has-file' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => document.getElementById(inputId)?.click()}
    >
      <input 
        id={inputId}
        type="file" 
        accept={accept} 
        onChange={handleChange} 
        style={{ display: 'none' }} 
      />
      
      {selectedFile ? (
        <>
          <CheckCircle size={24} className="drop-icon" />
          <div className="drop-zone__content">
            <span className="file-name">{selectedFile.name}</span>
            <span className="file-hint">{t('uploader.click_to_change')}</span>
          </div>
          <button 
            className="remove-file-btn" 
            onClick={handleRemove}
            title={t('uploader.remove_file')}
            aria-label={t('uploader.remove_file')}
          >
            <Trash2 size={18} />
          </button>
        </>
      ) : (
        <>
          <UploadCloud size={24} className="drop-icon" />
          <div className="drop-zone__content">
            <span className="file-name">{label}</span>
            <span className="file-hint">{t('uploader.drag_drop')}</span>
          </div>
        </>
      )}
    </div>
  );
}
