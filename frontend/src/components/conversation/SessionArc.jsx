export default function SessionArc({ dataPoints }) {
  const width = 220, height = 80, padding = 10;
  const maxVal = Math.max(...dataPoints, 1);
  const minVal = Math.min(...dataPoints, 0);
  const range = maxVal - minVal || 1;

  const pathD = dataPoints.reduce((acc, val, i) => {
    const x = padding + (i / (dataPoints.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (val - minVal) / range) * (height - padding * 2);
    if (i === 0) return `M ${x} ${y}`;
    const prevX = padding + ((i - 1) / (dataPoints.length - 1)) * (width - padding * 2);
    const prevY = padding + (1 - (dataPoints[i - 1] - minVal) / range) * (height - padding * 2);
    const cp1x = prevX + (x - prevX) / 2, cp1y = prevY;
    const cp2x = prevX + (x - prevX) / 2, cp2y = y;
    return `${acc} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x} ${y}`;
  }, "");

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="arcGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(212, 165, 116, 0.6)" />
          <stop offset="100%" stopColor="rgba(212, 165, 116, 0.05)" />
        </linearGradient>
      </defs>
      <path d={`${pathD} L ${width - padding} ${height} L ${padding} ${height} Z`} fill="url(#arcGradient)" opacity="0.3" />
      <path d={pathD} fill="none" stroke="#d4a574" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {dataPoints.length > 0 && (
        <circle cx={padding + (width - padding * 2)} cy={padding + (1 - (dataPoints[dataPoints.length - 1] - minVal) / range) * (height - padding * 2)} r="3" fill="#d4a574" />
      )}
    </svg>
  );
}
