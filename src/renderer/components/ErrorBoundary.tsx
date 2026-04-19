import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Inner fallback UI. Rendered as a function component so it can use hooks
 * (specifically `useTranslation`) while the outer class component handles
 * the actual error boundary lifecycle methods that React requires.
 */
function ErrorFallback({ error }: { error: Error }): ReactElement {
  const { t } = useTranslation();

  const handleReload = (): void => {
    window.location.reload();
  };

  return (
    <div
      role="alert"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
    >
      <div className="card" style={{ maxWidth: 520, width: '100%' }}>
        <h2 style={{ margin: '0 0 8px 0' }}>{t('errors.unexpected')}</h2>
        <p style={{ margin: '0 0 16px 0', opacity: 0.8 }}>{error.message}</p>
        <button type="button" className="btn" onClick={handleReload}>
          {t('errors.reload')}
        </button>
      </div>
    </div>
  );
}

/**
 * Top-level React error boundary. Catches render/commit-time errors anywhere
 * below it in the tree and shows a design-system styled recovery screen.
 *
 * Using a class component is required — React does not expose the error
 * boundary lifecycle hooks to function components.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught error', error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
