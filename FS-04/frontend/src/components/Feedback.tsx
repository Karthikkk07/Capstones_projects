import type { ReactNode } from 'react';

export function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div className="error" role="alert">
      <span>{message}</span>
      {onDismiss && (
        <button className="btn-link" onClick={onDismiss} aria-label="Dismiss error">
          ×
        </button>
      )}
    </div>
  );
}

export function Loading({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (error) return <ErrorBanner message={error} />;
  if (loading) return <p className="muted">Loading…</p>;
  return <>{children}</>;
}
