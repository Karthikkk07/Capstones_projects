import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders the percentage and aria values', () => {
    render(<ProgressBar percent={42} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(bar.firstElementChild).toHaveStyle({ width: '42%' });
  });

  it('clamps and rounds out-of-range values', () => {
    const { rerender } = render(<ProgressBar percent={150} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<ProgressBar percent={-5} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    rerender(<ProgressBar percent={33.6} label="Custom" />);
    expect(screen.getByLabelText('Custom')).toHaveAttribute('aria-valuenow', '34');
  });
});
