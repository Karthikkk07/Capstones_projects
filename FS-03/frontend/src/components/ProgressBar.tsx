interface Props {
  percent: number;
  label?: string;
}

export function ProgressBar({ percent, label }: Props) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="progress">
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Course progress'}
      >
        <div className="progress-fill" style={{ width: `${value}%` }} />
      </div>
      <span className="progress-label">{value}%</span>
    </div>
  );
}
