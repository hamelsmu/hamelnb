import {loadFont as loadDisplayFont} from '@remotion/google-fonts/HankenGrotesk';
import {loadFont as loadMonoFont} from '@remotion/google-fonts/MartianMono';
import type {CSSProperties, ReactNode} from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const {fontFamily: displayFont} = loadDisplayFont('normal', {
  weights: ['500', '700', '800'],
  subsets: ['latin'],
});
const {fontFamily: monoFont} = loadMonoFont('normal', {
  weights: ['400', '700'],
  subsets: ['latin'],
});

type TerminalLineKind = 'command' | 'kernel' | 'diff' | 'note';

type TerminalLine = {
  text: string;
  kind: TerminalLineKind;
  start: number;
  speed?: number;
};

const COLORS = {
  ink: '#081119',
  panel: '#0d1720',
  panelBorder: 'rgba(156, 188, 207, 0.16)',
  panelGlow: 'rgba(49, 191, 166, 0.18)',
  paper: '#f6efe5',
  paperEdge: '#e4d3bf',
  orange: '#ff9651',
  amber: '#ffd36a',
  teal: '#43d7c8',
  cyan: '#7ed8ff',
  green: '#87f4a0',
  red: '#ff7f77',
  navy: '#112330',
  steel: '#7790a0',
  softText: '#c2d0da',
  mutedDark: '#203545',
};

const terminalLines: TerminalLine[] = [
  {text: '$ jupyter-live-kernel exec demo.ipynb 2', kind: 'command', start: 72, speed: 2.8},
  {text: '[kernel] matched notebook session', kind: 'kernel', start: 110, speed: 3.8},
  {text: '[kernel] cell 2 ok in 84 ms', kind: 'kernel', start: 128, speed: 3.8},
  {text: '$ jupyter-live-kernel exec demo.ipynb 3', kind: 'command', start: 192, speed: 2.8},
  {text: '[kernel] reused dataframe state', kind: 'kernel', start: 228, speed: 3.6},
  {text: '[kernel] chart written to cell 3', kind: 'kernel', start: 250, speed: 3.7},
  {text: '$ jupyter-live-kernel edit demo.ipynb 3', kind: 'command', start: 376, speed: 2.8},
  {text: '+ daily["rolling"] = daily.tokens.ewm(span=3).mean()', kind: 'diff', start: 410, speed: 3.1},
  {text: '[agent] notebook saved through Contents API', kind: 'note', start: 450, speed: 4.2},
  {text: '$ jupyter-live-kernel exec demo.ipynb 3', kind: 'command', start: 492, speed: 2.8},
  {text: '[kernel] updated chart with rolling mean', kind: 'kernel', start: 534, speed: 3.8},
];

const previewRows = [
  {day: 'Tue', step: 'load', tokens: 118, sec: '0.7'},
  {day: 'Wed', step: 'rank', tokens: 154, sec: '0.9'},
];

const barValues = [118, 154, 165, 218, 236, 264];
const rollingValues = [118, 136, 150, 184, 210, 237];
const dayLabels = ['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const easeProgress = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });

const mix = (from: number, to: number, progress: number) => from + (to - from) * progress;

const lineColor = (kind: TerminalLineKind) => {
  switch (kind) {
    case 'command':
      return COLORS.amber;
    case 'kernel':
      return COLORS.cyan;
    case 'diff':
      return COLORS.green;
    case 'note':
      return COLORS.softText;
    default:
      return COLORS.softText;
  }
};

const visibleText = (line: TerminalLine, frame: number) => {
  const progress = Math.max(0, frame - line.start);
  const chars = Math.floor(progress * (line.speed ?? 3.4));
  return line.text.slice(0, chars);
};

const isLineTyping = (line: TerminalLine, frame: number) => {
  const duration = Math.ceil(line.text.length / (line.speed ?? 3.4));
  return frame >= line.start && frame <= line.start + duration + 4;
};

const isBusy = (frame: number) => {
  const inCell2 = frame >= 72 && frame < 138;
  const inCell3 = frame >= 192 && frame < 266;
  const inRerun = frame >= 492 && frame < 570;
  return inCell2 || inCell3 || inRerun;
};

const Badge = ({label, accent}: {label: string; accent: string}) => (
  <div
    style={{
      padding: '14px 22px',
      borderRadius: 999,
      border: `1px solid ${accent}55`,
      background: `${accent}18`,
      color: accent,
      fontFamily: displayFont,
      fontSize: 24,
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    }}
  >
    {label}
  </div>
);

const SectionLabel = ({label, accent}: {label: string; accent: string}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 12,
      color: accent,
      fontFamily: displayFont,
      fontSize: 24,
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    }}
  >
    <div
      style={{
        width: 14,
        height: 14,
        borderRadius: 999,
        background: accent,
        boxShadow: `0 0 20px ${accent}99`,
      }}
    />
    {label}
  </div>
);

const PanelShell = ({children, style}: {children: ReactNode; style: CSSProperties}) => (
  <div
    style={{
      borderRadius: 34,
      overflow: 'hidden',
      boxShadow: '0 26px 90px rgba(0, 0, 0, 0.34)',
      ...style,
    }}
  >
    {children}
  </div>
);

const HeaderBar = ({frame}: {frame: number}) => {
  const titleProgress = easeProgress(frame, 0, 26);
  const badgeShift = easeProgress(frame, 14, 44);

  return (
    <div
      style={{
        position: 'absolute',
        left: 68,
        top: 48,
        right: 68,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        transform: `translateY(${mix(24, 0, titleProgress)}px)`,
        opacity: titleProgress,
      }}
    >
      <div style={{maxWidth: 980}}>
        <SectionLabel label="Coding Agent Demo" accent={COLORS.orange} />
        <div
          style={{
            marginTop: 20,
            color: '#f5f7fb',
            fontFamily: displayFont,
            fontSize: 68,
            fontWeight: 800,
            lineHeight: 0.96,
            letterSpacing: '-0.05em',
          }}
        >
          Agent drives a live notebook kernel
        </div>
        <div
          style={{
            marginTop: 18,
            color: '#bed0dd',
            fontFamily: displayFont,
            fontSize: 22,
            fontWeight: 500,
            lineHeight: 1.16,
            maxWidth: 720,
          }}
        >
          Execute notebook cells incrementally, patch notebook code through the Contents API, and keep the kernel warm.
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 16,
          transform: `translateY(${mix(-18, 0, badgeShift)}px)`,
          opacity: badgeShift,
        }}
      >
        <Badge label="Warm Kernel" accent={COLORS.teal} />
        <Badge label="Cell Patch" accent={COLORS.amber} />
        <Badge label="JupyterLab" accent={COLORS.cyan} />
      </div>
    </div>
  );
};

const TerminalPane = ({frame}: {frame: number}) => {
  const {fps} = useVideoConfig();
  const intro = spring({
    fps,
    frame: frame - 10,
    config: {damping: 18, stiffness: 110, mass: 0.85},
  });
  const activeIndex = terminalLines.reduce((current, line, index) => {
    return frame >= line.start ? index : current;
  }, 0);

  return (
    <PanelShell
      style={{
        flex: 0.93,
        background: `linear-gradient(180deg, ${COLORS.panel} 0%, #081018 100%)`,
        border: `1px solid ${COLORS.panelBorder}`,
        transform: `translateY(${mix(42, 0, intro)}px) scale(${mix(0.96, 1, intro)})`,
        boxShadow: `0 30px 90px rgba(0, 0, 0, 0.4), 0 0 120px ${COLORS.panelGlow}`,
      }}
    >
      <div
        style={{
          height: 84,
          borderBottom: `1px solid ${COLORS.panelBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 28px',
          background: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <div style={{display: 'flex', gap: 12}}>
          {['#ff6a5a', '#ffc857', '#35d07f'].map((color) => (
            <div
              key={color}
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: color,
                boxShadow: `0 0 16px ${color}66`,
              }}
            />
          ))}
        </div>

        <div
          style={{
            color: '#e8eff5',
            fontFamily: displayFont,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '-0.03em',
          }}
        >
          codex session
        </div>

        <div
          style={{
            padding: '10px 16px',
            borderRadius: 999,
            background: isBusy(frame) ? `${COLORS.teal}18` : 'rgba(255, 255, 255, 0.05)',
            border: `1px solid ${isBusy(frame) ? `${COLORS.teal}55` : COLORS.panelBorder}`,
            color: isBusy(frame) ? COLORS.teal : COLORS.softText,
            fontFamily: displayFont,
            fontSize: 22,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {isBusy(frame) ? 'Running' : 'Idle'}
        </div>
      </div>

      <div style={{padding: '28px 32px 24px 32px'}}>
        <div
          style={{
            color: '#6e8697',
            fontFamily: monoFont,
            fontSize: 20,
            marginBottom: 18,
          }}
        >
          /Users/hamel/git/hamelnb
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {terminalLines.map((line, index) => {
            if (frame < line.start - 6) {
              return null;
            }

            const shown = visibleText(line, frame);
            const typing = isLineTyping(line, frame);
            const active = index === activeIndex && frame >= line.start;
            const cursorVisible = typing && Math.floor(frame / 8) % 2 === 0;

            return (
              <div
                  key={`${line.start}-${index}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  minHeight: 38,
                  padding: '6px 12px',
                  marginLeft: line.kind === 'diff' ? 18 : 0,
                  borderRadius: 14,
                  background: active ? 'rgba(255, 255, 255, 0.055)' : 'transparent',
                  border: active ? `1px solid ${COLORS.panelBorder}` : '1px solid transparent',
                  transform: `translateX(${Math.max(0, line.start - frame) * -1.2}px)`,
                  opacity: clamp((frame - line.start + 12) / 14),
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    marginRight: 14,
                    background: lineColor(line.kind),
                    boxShadow: `0 0 14px ${lineColor(line.kind)}55`,
                    opacity: active ? 1 : 0.45,
                  }}
                />
                <div
                  style={{
                    fontFamily: monoFont,
                    fontSize: 22,
                    color: lineColor(line.kind),
                    lineHeight: 1.35,
                    whiteSpace: 'pre',
                  }}
                >
                  {shown}
                  {cursorVisible ? '_' : ''}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 28,
            padding: '22px 24px',
            borderRadius: 22,
            background: 'rgba(255, 255, 255, 0.035)',
            border: `1px solid ${COLORS.panelBorder}`,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
          }}
        >
          {[
            {label: 'Cells targeted', value: '2 -> 3 -> 3'},
            {label: 'Kernel restarts', value: '0'},
            {label: 'Notebook writes', value: '1 save'},
          ].map((item) => (
            <div key={item.label}>
              <div
                style={{
                  color: '#7e93a2',
                  fontFamily: displayFont,
                  fontSize: 20,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  marginTop: 10,
                  color: '#f7fbff',
                  fontFamily: displayFont,
                  fontSize: 34,
                  fontWeight: 700,
                  letterSpacing: '-0.03em',
                }}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
};

const NotebookHeader = ({frame}: {frame: number}) => {
  const busy = isBusy(frame);
  return (
    <div
      style={{
        height: 72,
        borderBottom: `1px solid ${COLORS.paperEdge}`,
        background: '#f7f1e7',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 22px 0 18px',
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            background: COLORS.orange,
            boxShadow: `0 0 22px ${COLORS.orange}66`,
          }}
        />
        <div
          style={{
            padding: '13px 18px',
            borderRadius: 18,
            background: '#fff9f1',
            border: `1px solid ${COLORS.paperEdge}`,
            color: COLORS.navy,
            fontFamily: displayFont,
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          demo.ipynb
        </div>
      </div>

      <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
        <div
          style={{
            color: COLORS.mutedDark,
            fontFamily: displayFont,
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          Python 3 (ipykernel)
        </div>
        <div
          style={{
            padding: '8px 14px',
            borderRadius: 999,
            background: busy ? `${COLORS.orange}18` : '#eef6f0',
            border: `1px solid ${busy ? `${COLORS.orange}55` : '#bfdcc7'}`,
            color: busy ? COLORS.orange : '#257a42',
            fontFamily: displayFont,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {busy ? 'Busy' : 'Idle'}
        </div>
      </div>
    </div>
  );
};

const NotebookCell = ({
  cellLabel,
  frame,
  runWindow,
  editWindow,
  codeLines,
  insertedLine,
  output,
}: {
  cellLabel: string;
  frame: number;
  runWindow: [number, number];
  editWindow?: [number, number];
  codeLines: string[];
  insertedLine?: string;
  output: ReactNode;
}) => {
  const running = frame >= runWindow[0] && frame < runWindow[1];
  const done = frame >= runWindow[1];
  const editProgress = editWindow ? easeProgress(frame, editWindow[0], editWindow[1]) : 0;
  const showInserted = insertedLine && frame >= (editWindow?.[0] ?? Number.MAX_SAFE_INTEGER) - 4;

  return (
    <div
      style={{
        borderRadius: 24,
        overflow: 'hidden',
        border: `1px solid ${running ? `${COLORS.orange}66` : done ? '#c8d9c6' : COLORS.paperEdge}`,
        boxShadow: running
          ? `0 0 0 3px ${COLORS.orange}18`
          : done
            ? '0 16px 36px rgba(17, 35, 48, 0.08)'
            : '0 12px 30px rgba(17, 35, 48, 0.05)',
        background: '#fffdf9',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '100px 1fr',
          background: '#fffaf4',
        }}
      >
        <div
          style={{
            padding: '18px 16px',
            borderRight: `1px solid ${COLORS.paperEdge}`,
            color: running ? COLORS.orange : '#6d7f89',
            fontFamily: monoFont,
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          In [{cellLabel}]:
        </div>

        <div style={{padding: '18px 22px 18px 24px'}}>
          <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
            {codeLines.map((line) => (
              <div
                key={line}
                style={{
                  fontFamily: monoFont,
                  fontSize: 20,
                  lineHeight: 1.3,
                  color: COLORS.navy,
                  whiteSpace: 'pre',
                }}
              >
                {line}
              </div>
            ))}

            {showInserted ? (
              <div
                style={{
                  fontFamily: monoFont,
                  fontSize: 20,
                  lineHeight: 1.3,
                  color: COLORS.navy,
                  whiteSpace: 'pre',
                  background: `linear-gradient(90deg, ${COLORS.amber}32 0%, rgba(255, 211, 106, 0.08) 100%)`,
                  borderRadius: 12,
                  padding: '7px 10px',
                  transform: `translateY(${mix(12, 0, editProgress)}px)`,
                  opacity: insertedLine ? clamp(editProgress + 0.08) : 0,
                }}
              >
                {insertedLine?.slice(0, Math.max(1, Math.floor(insertedLine.length * Math.max(editProgress, 0.18))))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        style={{
          borderTop: `1px solid ${COLORS.paperEdge}`,
          display: 'grid',
          gridTemplateColumns: '100px 1fr',
          background: '#ffffff',
        }}
      >
        <div
          style={{
            padding: '18px 16px',
            borderRight: `1px solid ${COLORS.paperEdge}`,
            color: done ? '#2d7a42' : '#9cb0ba',
            fontFamily: monoFont,
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          Out[{cellLabel}]:
        </div>
        <div style={{padding: '18px 22px 18px 24px'}}>{output}</div>
      </div>
    </div>
  );
};

const TableOutput = ({frame}: {frame: number}) => {
  const reveal = easeProgress(frame, 112, 148);
  return (
    <div
      style={{
        opacity: reveal,
        transform: `translateY(${mix(14, 0, reveal)}px)`,
      }}
    >
      <div
        style={{
          color: '#4a6271',
          fontFamily: displayFont,
          fontSize: 20,
          fontWeight: 700,
          marginBottom: 10,
        }}
      >
        842 rows loaded into the active kernel
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr 96px 64px',
          gap: 10,
          alignItems: 'center',
        }}
      >
        {['day', 'step', 'tokens', 'sec'].map((label) => (
          <div
            key={label}
            style={{
              color: '#5b7080',
              fontFamily: displayFont,
              fontSize: 17,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {label}
          </div>
        ))}
        {previewRows.map((row, index) => (
          <div
            key={row.day}
            style={{
              display: 'contents',
            }}
          >
            <div
              style={{fontFamily: monoFont, fontSize: 18, color: COLORS.navy}}
            >
              {row.day}
            </div>
            <div
              style={{fontFamily: monoFont, fontSize: 18, color: COLORS.navy}}
            >
              {row.step}
            </div>
            <div
              style={{fontFamily: monoFont, fontSize: 18, color: COLORS.navy}}
            >
              {Math.round(mix(0, row.tokens, clamp(reveal - index * 0.08)))}
            </div>
            <div
              style={{fontFamily: monoFont, fontSize: 18, color: COLORS.navy}}
            >
              {row.sec}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const TrendOutput = ({frame}: {frame: number}) => {
  const {fps} = useVideoConfig();
  const barsIn = easeProgress(frame, 252, 312);
  const rerunIn = easeProgress(frame, 522, 570);
  const width = 690;
  const height = 150;
  const max = 280;
  const columnWidth = 74;
  const gap = 22;
  const baseline = 118;
  const points = rollingValues.map((value, index) => {
    const x = 44 + index * (columnWidth + gap) + columnWidth / 2;
    const y = baseline - (value / max) * 78;
    return `${x},${y}`;
  });

  return (
    <div
      style={{
        opacity: Math.max(barsIn, 0.06),
        transform: `translateY(${mix(18, 0, barsIn)}px)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            color: '#4a6271',
            fontFamily: displayFont,
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          Daily token totals from the warm kernel session
        </div>
        <div style={{display: 'flex', gap: 18}}>
          <LegendSwatch label="tokens" color={COLORS.cyan} />
          <LegendSwatch label="rolling" color={COLORS.orange} active={rerunIn > 0.08} />
        </div>
      </div>

      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1="22" y1={baseline + 0.5} x2={width - 20} y2={baseline + 0.5} stroke="#d5c7b7" strokeWidth="2" />
        <line x1="22" y1="26" x2="22" y2={baseline + 4} stroke="#d5c7b7" strokeWidth="2" />

        {barValues.map((value, index) => {
          const delay = index * 6;
          const growth = spring({
            fps,
            frame: frame - 252 - delay,
            config: {damping: 20, stiffness: 120, mass: 0.9},
          });
          const reveal = clamp(growth * barsIn);
          const heightValue = value / max * 78 * reveal;
          const x = 44 + index * (columnWidth + gap);
          const y = baseline - heightValue;
          const labelValue = Math.round(mix(0, value, reveal));
          return (
            <g key={dayLabels[index]}>
              <rect
                x={x}
                y={y}
                rx="16"
                width={columnWidth}
                height={heightValue}
                fill="url(#tokenGradient)"
              />
              <text
                x={x + columnWidth / 2}
                y={y - 12}
                textAnchor="middle"
                fontFamily={displayFont}
                fontWeight="700"
                fontSize="16"
                fill={COLORS.navy}
              >
                {labelValue}
              </text>
              <text
                x={x + columnWidth / 2}
                y={baseline + 22}
                textAnchor="middle"
                fontFamily={displayFont}
                fontWeight="700"
                fontSize="16"
                fill="#526877"
              >
                {dayLabels[index]}
              </text>
            </g>
          );
        })}

        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={COLORS.orange}
          strokeWidth="7"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - rerunIn}
          opacity={rerunIn}
        />

        {rollingValues.map((value, index) => {
          const x = 44 + index * (columnWidth + gap) + columnWidth / 2;
          const y = baseline - (value / max) * 78;
          return (
            <circle
              key={`dot-${dayLabels[index]}`}
              cx={x}
              cy={y}
              r={mix(0, 5, rerunIn)}
              fill={COLORS.orange}
              opacity={rerunIn}
            />
          );
        })}

        <defs>
          <linearGradient id="tokenGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#7ed8ff" />
            <stop offset="100%" stopColor="#2ba6d8" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};

const LegendSwatch = ({
  label,
  color,
  active = true,
}: {
  label: string;
  color: string;
  active?: boolean;
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      opacity: active ? 1 : 0.35,
    }}
  >
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: 999,
        background: color,
      }}
    />
    <div
      style={{
        color: '#516878',
        fontFamily: displayFont,
        fontSize: 16,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {label}
    </div>
  </div>
);

const NotebookPane = ({frame}: {frame: number}) => {
  const {fps} = useVideoConfig();
  const intro = spring({
    fps,
    frame: frame - 18,
    config: {damping: 18, stiffness: 105, mass: 0.9},
  });

  return (
    <PanelShell
      style={{
        flex: 1.18,
        background: `linear-gradient(180deg, ${COLORS.paper} 0%, #f9f4ed 100%)`,
        border: `1px solid ${COLORS.paperEdge}`,
        transform: `translateY(${mix(58, 0, intro)}px) scale(${mix(0.95, 1, intro)})`,
      }}
    >
      <NotebookHeader frame={frame} />
      <div
        style={{
          padding: '18px 20px 20px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <NotebookCell
          cellLabel="2"
          frame={frame}
          runWindow={[72, 138]}
          codeLines={['logs = load_agent_runs()', 'logs.tail(4)']}
          output={<TableOutput frame={frame} />}
        />

        <NotebookCell
          cellLabel="3"
          frame={frame}
          runWindow={[192, 266]}
          editWindow={[386, 452]}
          codeLines={['daily = logs.groupby("day").tokens.sum().reset_index()', 'daily']}
          insertedLine={'daily["rolling"] = daily.tokens.ewm(span=3).mean()'}
          output={<TrendOutput frame={frame} />}
        />
      </div>
    </PanelShell>
  );
};

const StepStrip = ({frame}: {frame: number}) => {
  const intro = easeProgress(frame, 22, 74);
  const steps = [
    {label: 'Run cell 2', start: 72, end: 160},
    {label: 'Run cell 3', start: 192, end: 320},
    {label: 'Patch + rerun', start: 376, end: 570},
  ];

  return (
    <div
      style={{
        position: 'absolute',
        left: 68,
        right: 68,
        bottom: 24,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 14,
        opacity: intro,
        transform: `translateY(${mix(18, 0, intro)}px)`,
      }}
    >
      {steps.map((step) => {
        const active = frame >= step.start && frame < step.end;
        const done = frame >= step.end;
        return (
          <div
            key={step.label}
            style={{
              padding: '14px 18px',
              borderRadius: 20,
              border: `1px solid ${active ? `${COLORS.orange}55` : 'rgba(174, 198, 215, 0.18)'}`,
              background: active
                ? 'rgba(255, 150, 81, 0.12)'
                : done
                  ? 'rgba(67, 215, 200, 0.11)'
                  : 'rgba(255, 255, 255, 0.03)',
            }}
          >
            <div
              style={{
                color: done ? COLORS.teal : active ? COLORS.amber : '#a4b7c4',
                fontFamily: displayFont,
                fontSize: 16,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {done ? 'Complete' : active ? 'Live' : 'Queued'}
            </div>
            <div
              style={{
                marginTop: 6,
                color: '#f5f7fb',
                fontFamily: displayFont,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: '-0.03em',
              }}
            >
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const Background = ({frame}: {frame: number}) => {
  const drift = Math.sin(frame / 42) * 18;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 18% 20%, rgba(255, 150, 81, 0.22) 0%, rgba(255, 150, 81, 0) 28%), radial-gradient(circle at 88% 18%, rgba(67, 215, 200, 0.12) 0%, rgba(67, 215, 200, 0) 22%), linear-gradient(140deg, #050b12 0%, #0b1722 44%, #09121c 100%)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(128, 154, 170, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(128, 154, 170, 0.08) 1px, transparent 1px)',
          backgroundSize: '96px 96px',
          maskImage: 'linear-gradient(180deg, rgba(0, 0, 0, 0.65), transparent)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 540,
          height: 540,
          borderRadius: '50%',
          border: '1px solid rgba(126, 216, 255, 0.12)',
          left: -120,
          top: 380 + drift,
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 620,
          height: 620,
          borderRadius: '50%',
          border: '1px solid rgba(255, 211, 106, 0.12)',
          right: -120,
          top: 180 - drift,
        }}
      />
    </AbsoluteFill>
  );
};

export const SkillShowcase = () => {
  const frame = useCurrentFrame();
  const stageIntro = easeProgress(frame, 10, 62);

  return (
    <AbsoluteFill>
      <Background frame={frame} />
      <HeaderBar frame={frame} />

      <div
        style={{
          position: 'absolute',
          left: 68,
          right: 68,
          top: 316,
          bottom: 140,
          display: 'flex',
          gap: 28,
          transform: `translateY(${mix(22, 0, stageIntro)}px)`,
          opacity: stageIntro,
        }}
      >
        <TerminalPane frame={frame} />
        <NotebookPane frame={frame} />
      </div>

      <StepStrip frame={frame} />
    </AbsoluteFill>
  );
};
