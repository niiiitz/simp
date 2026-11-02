import React from 'react';
import { encodeQrMatrix } from './qrMatrix';

export const QrCodeSvg: React.FC<{
  value: string;
  size?: number;
  bgColor?: string;
  fgColor?: string;
}> = ({ value, size = 148, bgColor = '#ffffff', fgColor = '#07070c' }) => {
  const matrix = encodeQrMatrix(value);
  const n = matrix.length;
  const quiet = 2;
  const viewBoxSize = n + quiet * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      shapeRendering="crispEdges"
      style={{
        borderRadius: 12,
        background: bgColor,
        padding: 4,
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    >
      <rect width={viewBoxSize} height={viewBoxSize} fill={bgColor} />
      {matrix.map((row, r) =>
        row.map((cell, c) =>
          cell ? <rect key={`${r}-${c}`} x={c + quiet} y={r + quiet} width={1} height={1} fill={fgColor} /> : null
        )
      )}
    </svg>
  );
};
