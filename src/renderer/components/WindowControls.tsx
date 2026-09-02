import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * WindowControls — Windows-style minimize / max-restore / close captions for
 * the frameless window. Rendered inside the in-app TitleBar (and as a float
 * overlay on the chromeless wizard page). Colors come from the `.wincap`
 * styles, so the captions always follow the active theme.
 */
export function WindowControls(): ReactElement {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    void window.opendeploy.winIsMaximized().then((m) => {
      if (!disposed) setMaximized(m);
    });
    const off = window.opendeploy.winOnMaximized((m) => setMaximized(m));
    return () => {
      disposed = true;
      off();
    };
  }, []);

  return (
    <div className="wincaps">
      <button
        type="button"
        className="wincap"
        aria-label={t('titlebar.minimize')}
        title={t('titlebar.minimize')}
        onClick={() => void window.opendeploy.winMinimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5H10V4.5H0V5.5Z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="wincap"
        aria-label={t('titlebar.maximize')}
        title={t('titlebar.maximize')}
        onClick={() => void window.opendeploy.winToggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M2.5 0.5H9.5V7.5H8V8.5H1V2H2.5V0.5ZM3 2V3.5H8V2H3ZM2 4.5V7.5H7V4.5H2Z"
              fill="currentColor"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0.5 0.5H9.5V9.5H0.5V0.5ZM2 2V8H8V2H2Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="wincap close"
        aria-label={t('titlebar.close')}
        title={t('titlebar.close')}
        onClick={() => void window.opendeploy.winClose()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.6 0L5 4.4L9.4 0L10 0.6L5.6 5L10 9.4L9.4 10L5 5.6L0.6 10L0 9.4L4.4 5L0 0.6L0.6 0Z" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}

export default WindowControls;
