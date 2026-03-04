import { useEffect } from 'react';
import { X } from 'lucide-react';
import styles from './AboutModal.module.css';

interface Props {
  onClose: () => void;
  isClosing?: boolean;
}

export default function AboutModal({ onClose, isClosing = false }: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className={`${styles.overlay} ${isClosing ? styles.overlayClosing : ''}`} onClick={onClose}>
      <div className={`${styles.modal} ${isClosing ? styles.modalClosing : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={styles.title}>About</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className={styles.body}>
          <p>
            actuallyEXPLAIN is a visualizer that helps you understand complex PostgreSQL queries in a diagram and dictionarized form.
          </p>
          <p>Paste your code, and check the logic. No database connection required.</p>
          <p>
            This may be useful for full-stack developers, indie hackers, and perhaps anyone using AI to write SQL who needs to verify what the code actually does before running it in production.
          </p>
          <p>
            Right now, it just maps the logical intent. In the future, we want to help flag dangerous anti-patterns, warning you about potential database locks, and catching bad queries before they ever execute.
          </p>
        </div>

        <hr className={styles.divider} />

        <footer className={styles.footer}>
          Open source under the MIT license. You're welcome to <a href="https://github.com/freenandes/actuallyexplain">view the code</a>, suggest stuff and contribute.
        </footer>
      </div>
    </div>
  );
}
