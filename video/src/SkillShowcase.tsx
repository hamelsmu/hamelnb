import {loadFont as loadDisplayFont} from '@remotion/google-fonts/HankenGrotesk';
import {loadFont as loadMonoFont} from '@remotion/google-fonts/MartianMono';
import type {CSSProperties, ReactNode} from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
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

type TranscriptLineKind = 'prompt' | 'plan' | 'tools' | 'reply';

type Operation = {
  prompt: string;
  planText?: string;
  planStart?: number;
  typeStart: number;
  typeEnd: number;
  submitFrame: number;
  thinkingStart: number;
  thinkingEnd: number;
  toolsStart: number;
  toolsEnd: number;
  doneFrame: number;
  replyText: string;
  toolsCalled: number;
  toolDetails: string;
  thinkingLines: string[];
};

type TranscriptLine = {
  text: string;
  kind: TranscriptLineKind;
  start: number;
  speed?: number;
  details?: string;
};

const COLORS = {
  panel: '#0f1821',
  panelBorder: 'rgba(156, 188, 207, 0.18)',
  orange: '#ff8a3d',
  amber: '#f8ce72',
  teal: '#45d8c9',
  cyan: '#85dfff',
  green: '#8df5a6',
  softText: '#c5d4de',
};

const TRANSITIONS = {
  toState2: [134, 148] as const,
  toState3: [194, 210] as const,
  toState4: [282, 296] as const,
  toState5: [332, 346] as const,
  toState6: [392, 408] as const,
  toState7: [456, 472] as const,
  toState8: [508, 522] as const,
  toState9: [566, 582] as const,
};

const TARGET_NOTEBOOK_PATH = '/tmp/jupyter-live-kernel-demo/demo.ipynb';
const TARGET_NOTEBOOK_PORT = 8888;

const OPERATIONS: Operation[] = [
  {
    prompt: 'what is current base? run only needed cells',
    typeStart: 24,
    typeEnd: 78,
    submitFrame: 86,
    thinkingStart: 96,
    thinkingEnd: 166,
    toolsStart: 166,
    toolsEnd: 188,
    doneFrame: 214,
    replyText: 'Done. Base output is 1.',
    toolsCalled: 4,
    toolDetails: 'notebooks, AskUserQuestion, execute x3',
    thinkingLines: ['Resolve notebook target', 'Run setup/base cells', 'Read current output'],
  },
  {
    prompt: 'add a new cell: base * multiplier, then run it',
    typeStart: 228,
    typeEnd: 280,
    submitFrame: 288,
    thinkingStart: 296,
    thinkingEnd: 360,
    toolsStart: 360,
    toolsEnd: 386,
    doneFrame: 416,
    replyText: 'Done. New cell output is 5.',
    toolsCalled: 2,
    toolDetails: 'edit, execute',
    thinkingLines: ['Add calculation cell', 'Run only new cell', 'Read output 5'],
  },
  {
    prompt: 'make the final output 10',
    planText: 'plan: update base to 2, then rerun only dependent cells',
    planStart: 504,
    typeStart: 430,
    typeEnd: 492,
    submitFrame: 500,
    thinkingStart: 508,
    thinkingEnd: 546,
    toolsStart: 546,
    toolsEnd: 570,
    doneFrame: 596,
    replyText: 'Done. Reran dependent cells only; final output is 10.',
    toolsCalled: 3,
    toolDetails: 'edit, execute x3',
    thinkingLines: ['Read output: 5', 'Multiplier is 5, target is 10 -> base must be 2', 'Edit base and rerun dependent cells'],
  },
];

const transcriptLines: TranscriptLine[] = OPERATIONS.flatMap((op) => {
  const lines: TranscriptLine[] = [
    {
      text: `> ${op.prompt}`,
      kind: 'prompt',
      start: op.submitFrame,
      speed: 4.2,
    },
  ];
  if (op.planText && typeof op.planStart === 'number') {
    lines.push({
      text: op.planText,
      kind: 'plan',
      start: op.planStart,
      speed: 7.8,
    });
  }
  lines.push(
    {
      text: `..called ${op.toolsCalled} tools`,
      kind: 'tools',
      start: op.doneFrame,
      speed: 4.2,
      details: op.toolDetails,
    },
    {
      text: op.replyText,
      kind: 'reply',
      start: op.doneFrame + 16,
      speed: 4.2,
    },
  );
  return lines;
});

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const easeProgress = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });

const mix = (from: number, to: number, progress: number) => from + (to - from) * progress;

const lineColor = (kind: TranscriptLineKind) => {
  switch (kind) {
    case 'prompt':
      return '#f6f1e7';
    case 'plan':
      return '#cde9ff';
    case 'tools':
      return '#9eb0be';
    case 'reply':
      return '#d9e6ef';
    default:
      return COLORS.softText;
  }
};

const lineBackground = (kind: TranscriptLineKind) => {
  if (kind === 'tools') {
    return 'rgba(89, 118, 139, 0.16)';
  }
  if (kind === 'plan') {
    return 'rgba(87, 159, 214, 0.16)';
  }
  if (kind === 'reply') {
    return 'rgba(69, 216, 201, 0.08)';
  }
  return 'rgba(255, 255, 255, 0.03)';
};

const visibleText = (line: TranscriptLine, frame: number) => {
  const progress = Math.max(0, frame - line.start);
  const chars = Math.floor(progress * (line.speed ?? 3.6));
  return line.text.slice(0, chars);
};

const isLineTyping = (line: TranscriptLine, frame: number) => {
  const duration = Math.ceil(line.text.length / (line.speed ?? 3.6));
  return frame >= line.start && frame <= line.start + duration + 4;
};

const typedPromptText = (op: Operation, frame: number) => {
  if (frame < op.typeStart) {
    return '';
  }
  if (frame >= op.typeEnd) {
    return op.prompt;
  }
  const progress = Math.max(0, frame - op.typeStart);
  const chars = Math.floor(progress * 4);
  return op.prompt.slice(0, chars);
};

const activeOperation = (frame: number) =>
  OPERATIONS.find((op) => frame >= op.submitFrame && frame < op.doneFrame);

const statusText = (frame: number) => {
  const active = activeOperation(frame);
  if (!active) {
    return null;
  }
  if (frame >= active.submitFrame && frame < active.doneFrame) {
    return 'Thinking...';
  }
  return null;
};

const composingOperation = (frame: number) =>
  OPERATIONS.find((op) => frame >= op.typeStart && frame < op.submitFrame);

const isBusy = (frame: number) =>
  Boolean(activeOperation(frame));

const PanelShell = ({children, style}: {children: ReactNode; style: CSSProperties}) => (
  <div
    style={{
      borderRadius: 34,
      overflow: 'hidden',
      boxShadow: '0 18px 50px rgba(0, 0, 0, 0.3)',
      ...style,
    }}
  >
    {children}
  </div>
);

const HeaderBar = ({frame}: {frame: number}) => {
  const titleProgress = easeProgress(frame, 0, 30);

  return (
    <div
      style={{
        position: 'absolute',
        left: 74,
        top: 52,
        right: 74,
        transform: `translateY(${mix(20, 0, titleProgress)}px)`,
        opacity: titleProgress,
      }}
    >
      <div style={{maxWidth: 1200}}>
        <div
          style={{
            color: '#f5f7fb',
            fontFamily: displayFont,
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '-0.04em',
          }}
        >
          Give Your Coding Agent A Live Notebook Kernel.
        </div>
        <div
          style={{
            marginTop: 14,
            color: '#c1d2dd',
            fontFamily: displayFont,
            fontSize: 24,
            fontWeight: 500,
            lineHeight: 1.15,
            maxWidth: 980,
          }}
        >
          Run only affected cells and use fresh outputs to steer the next edit.
        </div>
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
  const visibleLines = transcriptLines.filter((line) => frame >= line.start - 6);
  const activeLineStart = visibleLines.reduce((current, line) => {
    return frame >= line.start ? line.start : current;
  }, -1);
  const composing = composingOperation(frame);
  const composerText = composing ? typedPromptText(composing, frame) : '';
  const showCursor = composerText.length > 0 && Math.floor(frame / 8) % 2 === 0;
  const isComposing = Boolean(composing);
  const composePulse = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(frame * 0.36));
  const status = statusText(frame);
  const isThinking = Boolean(status?.startsWith('Thinking'));
  const busy = isBusy(frame);
  const executingOp = activeOperation(frame);
  const executingPromptStart = executingOp ? executingOp.submitFrame : -1;
  const activeStepText = (() => {
    if (!executingOp || executingOp.thinkingLines.length === 0) {
      return '';
    }
    const span = Math.max(1, executingOp.toolsStart - executingOp.thinkingStart);
    const progress = clamp((frame - executingOp.thinkingStart) / span);
    const stepIndex = Math.min(
      executingOp.thinkingLines.length - 1,
      Math.floor(progress * executingOp.thinkingLines.length),
    );
    return executingOp.thinkingLines[stepIndex] ?? '';
  })();
  const statusDetailOpacity = executingOp
    ? clamp(
        interpolate(
          frame,
          [executingOp.thinkingStart, executingOp.thinkingStart + 10, executingOp.toolsStart + 20, executingOp.toolsStart + 28],
          [0, 1, 1, 0],
          {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          },
        ),
      )
    : 0;

  return (
    <PanelShell
      style={{
        flex: 0.9,
        background: `linear-gradient(180deg, ${COLORS.panel} 0%, #081018 100%)`,
        border: `1px solid ${COLORS.panelBorder}`,
        transform: `translateY(${mix(42, 0, intro)}px) scale(${mix(0.96, 1, intro)})`,
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.35)',
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
                width: 12,
                height: 12,
                borderRadius: 999,
                background: color,
              }}
            />
          ))}
        </div>

        <div
          style={{
            color: '#e8eff5',
            fontFamily: displayFont,
            fontSize: 27,
            fontWeight: 700,
            letterSpacing: '-0.03em',
          }}
        >
          coding agent terminal
        </div>

        <div
          style={{
            width: 48,
          }}
        />
      </div>

      <div
        style={{
          padding: '20px 20px 16px 20px',
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100% - 84px)',
        }}
      >
        <div
          style={{
            height: 34,
            borderRadius: 10,
            border: `1px solid ${COLORS.panelBorder}`,
            background: 'rgba(255, 255, 255, 0.02)',
            padding: '0 10px',
            display: 'flex',
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              marginRight: 10,
              background: COLORS.teal,
              opacity: 0.95,
            }}
          />
          <div
            style={{
              fontFamily: monoFont,
              fontSize: 13,
              color: '#d7e7f1',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {`target: ${TARGET_NOTEBOOK_PATH} (port ${TARGET_NOTEBOOK_PORT})`}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {visibleLines.map((line, index) => {
            const shown = visibleText(line, frame);
            const typing = isLineTyping(line, frame);
            const active = line.start === activeLineStart;
            const cursorVisible = typing && Math.floor(frame / 8) % 2 === 0;
            const isToolLine = line.kind === 'tools';
            const executingPrompt = line.kind === 'prompt' && line.start === executingPromptStart;

            return (
              <div
                key={`${line.start}-${index}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  minHeight: isToolLine ? 40 : 36,
                  padding: isToolLine ? '8px 10px' : '8px 12px',
                  borderRadius: 12,
                  border:
                    active || isToolLine
                      ? `1px solid ${line.kind === 'tools' ? 'rgba(130, 157, 176, 0.35)' : COLORS.panelBorder}`
                      : '1px solid transparent',
                  background: active || isToolLine ? lineBackground(line.kind) : 'transparent',
                  transform: `translateX(${Math.max(0, line.start - frame) * -0.9}px)`,
                  opacity: clamp((frame - line.start + 12) / 14),
                }}
              >
                {isToolLine ? (
                  <div
                    style={{
                      width: 16,
                      marginRight: 10,
                      color: '#a7b8c6',
                      fontFamily: monoFont,
                      fontSize: 15,
                    }}
                  >
                    ▸
                  </div>
                ) : (
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      marginRight: 12,
                      background: executingPrompt ? COLORS.orange : lineColor(line.kind),
                      boxShadow: executingPrompt ? `0 0 12px ${COLORS.orange}` : 'none',
                      opacity: executingPrompt || active ? 1 : 0.45,
                    }}
                  />
                )}
                <div
                  style={{
                    minWidth: 0,
                    flex: 1,
                    fontFamily: line.kind === 'reply' ? displayFont : monoFont,
                    fontSize:
                      line.kind === 'reply' ? 16 : line.kind === 'plan' ? 15 : isToolLine ? 15 : 17,
                    fontWeight: line.kind === 'reply' ? 500 : line.kind === 'plan' ? 600 : 400,
                    color: lineColor(line.kind),
                    lineHeight: line.kind === 'reply' ? 1.2 : 1.35,
                    whiteSpace: line.kind === 'reply' ? 'normal' : 'pre',
                    overflowWrap: line.kind === 'reply' ? 'anywhere' : 'normal',
                  }}
                >
                  {shown}
                  {cursorVisible ? '_' : ''}
                </div>
                {isToolLine ? (
                  <div
                    style={{
                      maxWidth: 0,
                      maxHeight: 0,
                      overflow: 'hidden',
                      opacity: 0,
                    }}
                  >
                    {line.details}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div style={{minHeight: 72, display: 'flex', alignItems: 'flex-start', padding: '2px 8px 0 8px'}}>
          {executingOp ? (
            <div
              style={{
                marginRight: 14,
                padding: '8px 10px',
                borderRadius: 10,
                border: `1px solid ${COLORS.panelBorder}`,
                background: 'rgba(255, 255, 255, 0.02)',
                minWidth: 0,
                flex: 1,
              }}
            >
              <div
                style={{
                  fontFamily: monoFont,
                  fontSize: 13,
                  lineHeight: 1.35,
                  color: '#9db2c1',
                  opacity: statusDetailOpacity,
                  height: 18,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
              >
                {activeStepText ? `Agent: ${activeStepText}...` : ''}
              </div>
            </div>
          ) : null}
          {status ? (
            <div
              style={{
                fontFamily: monoFont,
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: '0.01em',
                color: isThinking ? 'transparent' : COLORS.softText,
                backgroundImage: isThinking
                  ? 'linear-gradient(90deg, #93a5b3 0%, #d4f8ff 45%, #93a5b3 90%)'
                  : 'none',
                backgroundSize: '180% 100%',
                backgroundPosition: `${(frame * 5) % 180}% 0`,
                WebkitBackgroundClip: isThinking ? 'text' : undefined,
                backgroundClip: isThinking ? 'text' : undefined,
              }}
            >
              {status}
            </div>
          ) : null}
        </div>

        <div
          style={{
            borderTop: `1px solid ${COLORS.panelBorder}`,
            paddingTop: 12,
            marginTop: 2,
          }}
        >
          <div
            style={{
              height: 58,
              borderRadius: 14,
              border: isComposing
                ? `1px solid rgba(248, 206, 114, ${0.58 * composePulse})`
                : `1px solid ${COLORS.panelBorder}`,
              background: isComposing ? 'rgba(13, 26, 36, 0.94)' : 'rgba(6, 13, 20, 0.88)',
              boxShadow: isComposing
                ? `0 0 0 1px rgba(248, 206, 114, ${0.25 * composePulse}), 0 0 20px rgba(248, 206, 114, ${0.22 * composePulse})`
                : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 12px 0 16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                minWidth: 0,
                flex: 1,
              }}
            >
              <div
                style={{
                  color: isComposing ? '#ffd98f' : COLORS.amber,
                  fontFamily: monoFont,
                  fontSize: 18,
                  fontWeight: 700,
                }}
              >
                {'>'}
              </div>
              <div
                style={{
                  color: composerText ? '#e9f0f5' : isComposing ? '#95aab9' : '#748796',
                  fontFamily: monoFont,
                  fontSize: 16,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {composerText || (isBusy(frame) ? 'Agent is working…' : 'Type your request')}
                {showCursor ? '_' : ''}
              </div>
            </div>
            <div
              style={{
                borderRadius: 999,
                border: isComposing
                  ? `1px solid rgba(248, 206, 114, ${0.52 * composePulse})`
                  : `1px solid ${COLORS.panelBorder}`,
                color: isComposing ? '#d7c28f' : '#a8b7c3',
                fontFamily: displayFont,
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.02em',
                padding: '6px 12px',
              }}
            >
              Enter
            </div>
          </div>
        </div>
      </div>
    </PanelShell>
  );
};

const NotebookPane = ({frame}: {frame: number}) => {
  const {fps} = useVideoConfig();
  const intro = spring({
    fps,
    frame: frame - 18,
    config: {damping: 18, stiffness: 105, mass: 0.9},
  });

  const toState2 = easeProgress(frame, TRANSITIONS.toState2[0], TRANSITIONS.toState2[1]);
  const toState3 = easeProgress(frame, TRANSITIONS.toState3[0], TRANSITIONS.toState3[1]);
  const toState4 = easeProgress(frame, TRANSITIONS.toState4[0], TRANSITIONS.toState4[1]);
  const toState5 = easeProgress(frame, TRANSITIONS.toState5[0], TRANSITIONS.toState5[1]);
  const toState6 = easeProgress(frame, TRANSITIONS.toState6[0], TRANSITIONS.toState6[1]);
  const toState7 = easeProgress(frame, TRANSITIONS.toState7[0], TRANSITIONS.toState7[1]);
  const toState8 = easeProgress(frame, TRANSITIONS.toState8[0], TRANSITIONS.toState8[1]);
  const toState9 = easeProgress(frame, TRANSITIONS.toState9[0], TRANSITIONS.toState9[1]);
  const zoom = mix(1, 1.01, easeProgress(frame, 0, 700));
  const setupRunGlow = clamp(
    interpolate(frame, [136, 146, 188, 200], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const newCellRunGlow = clamp(
    interpolate(frame, [334, 344, 384, 396], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const badgeSetup = clamp(
    interpolate(frame, [136, 146, 184, 196], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const badgeNewCell = clamp(
    interpolate(frame, [334, 344, 382, 394], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const rerunCellGlow = clamp(
    interpolate(frame, [510, 520, 562, 574], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const glowPulse = 0.74 + 0.26 * (0.5 + 0.5 * Math.sin(frame * 0.33));
  const outputFive = clamp(
    interpolate(frame, [396, 408, 446, 458], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const badgeRerun = clamp(
    interpolate(frame, [522, 534, 566, 578], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const reasonHint = clamp(
    interpolate(frame, [516, 528, 568, 580], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const planHint = clamp(
    interpolate(frame, [526, 538, 572, 584], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  return (
    <PanelShell
      style={{
        flex: 1.35,
        background: '#eceff3',
        border: '1px solid rgba(255, 255, 255, 0.24)',
        transform: `translateY(${mix(58, 0, intro)}px) scale(${mix(0.95, 1, intro)})`,
      }}
    >
      <div style={{position: 'relative', width: '100%', height: '100%', overflow: 'hidden'}}>
        <Img
          src={staticFile('jupyter-seq/state-1.png')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom})`,
            opacity: 1 - toState2,
          }}
        />
        <Img
          src={staticFile('jupyter-seq/state-2.png')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom})`,
            opacity: toState2 * (1 - toState3),
          }}
        />
        <Img
          src={staticFile('jupyter-seq/state-3.png')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom})`,
            opacity: toState3 * (1 - toState4),
          }}
        />
        <Img
          src={staticFile('jupyter-seq/state-4.png')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom})`,
            opacity: toState4 * (1 - toState5),
          }}
        />
        <Img
          src={staticFile('jupyter-seq/state-5.png')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom})`,
            opacity: toState5 * (1 - toState6),
          }}
        />
        <Img
          src={staticFile('jupyter-seq/state-6.png')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom})`,
            opacity: toState6 * (1 - toState7),
          }}
        />
        <Img
          src={staticFile('jupyter-seq/state-7.png')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom})`,
            opacity: toState7 * (1 - toState8),
          }}
        />
        <Img
          src={staticFile('jupyter-seq/state-8.png')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom})`,
            opacity: toState8 * (1 - toState9),
          }}
        />
        <Img
          src={staticFile('jupyter-seq/state-9.png')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${zoom})`,
            opacity: toState9,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '7.4%',
            top: '4.8%',
            width: '91.1%',
            height: '4.5%',
            borderRadius: 8,
            border: '1.5px solid rgba(255, 145, 73, 0.82)',
            background:
              'linear-gradient(90deg, rgba(255, 145, 73, 0.18) 0%, rgba(255, 145, 73, 0.08) 58%, rgba(255, 145, 73, 0.03) 100%)',
            boxShadow: '0 0 18px rgba(255, 145, 73, 0.45)',
            opacity: setupRunGlow * glowPulse,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '7.4%',
            top: '10.1%',
            width: '91.1%',
            height: '4.5%',
            borderRadius: 8,
            border: '1.5px solid rgba(255, 145, 73, 0.82)',
            background:
              'linear-gradient(90deg, rgba(255, 145, 73, 0.18) 0%, rgba(255, 145, 73, 0.08) 58%, rgba(255, 145, 73, 0.03) 100%)',
            boxShadow: '0 0 18px rgba(255, 145, 73, 0.45)',
            opacity: setupRunGlow * glowPulse,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '7.4%',
            top: '15.4%',
            width: '91.1%',
            height: '4.5%',
            borderRadius: 8,
            border: '1.5px solid rgba(255, 145, 73, 0.82)',
            background:
              'linear-gradient(90deg, rgba(255, 145, 73, 0.18) 0%, rgba(255, 145, 73, 0.08) 58%, rgba(255, 145, 73, 0.03) 100%)',
            boxShadow: '0 0 18px rgba(255, 145, 73, 0.45)',
            opacity: setupRunGlow * glowPulse,
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 18,
            top: 18,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255, 138, 61, 0.55)',
            background: 'rgba(8, 22, 30, 0.82)',
            color: '#ffd5b2',
            fontFamily: monoFont,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.01em',
            opacity: badgeSetup,
            transform: `translateY(${mix(6, 0, badgeSetup)}px)`,
          }}
        >
          only these cells run: [1]-[3]
        </div>
        <div
          style={{
            position: 'absolute',
            right: 18,
            top: 18,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255, 138, 61, 0.55)',
            background: 'rgba(8, 22, 30, 0.82)',
            color: '#ffd5b2',
            fontFamily: monoFont,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.01em',
            opacity: badgeNewCell,
            transform: `translateY(${mix(6, 0, badgeNewCell)}px)`,
          }}
        >
          only these cells run: [4]
        </div>
        <div
          style={{
            position: 'absolute',
            left: '7.4%',
            top: '24.6%',
            width: '91.1%',
            height: '6.9%',
            borderRadius: 8,
            border: '1.5px solid rgba(255, 145, 73, 0.82)',
            background:
              'linear-gradient(90deg, rgba(255, 145, 73, 0.18) 0%, rgba(255, 145, 73, 0.08) 58%, rgba(255, 145, 73, 0.03) 100%)',
            boxShadow: '0 0 18px rgba(255, 145, 73, 0.45)',
            opacity: newCellRunGlow * glowPulse,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '7.4%',
            top: '10.1%',
            width: '91.1%',
            height: '4.5%',
            borderRadius: 8,
            border: '1.5px solid rgba(255, 145, 73, 0.82)',
            background:
              'linear-gradient(90deg, rgba(255, 145, 73, 0.18) 0%, rgba(255, 145, 73, 0.08) 58%, rgba(255, 145, 73, 0.03) 100%)',
            boxShadow: '0 0 18px rgba(255, 145, 73, 0.45)',
            opacity: rerunCellGlow * glowPulse,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '7.4%',
            top: '24.6%',
            width: '91.1%',
            height: '6.9%',
            borderRadius: 8,
            border: '1.5px solid rgba(255, 145, 73, 0.82)',
            background:
              'linear-gradient(90deg, rgba(255, 145, 73, 0.18) 0%, rgba(255, 145, 73, 0.08) 58%, rgba(255, 145, 73, 0.03) 100%)',
            boxShadow: '0 0 18px rgba(255, 145, 73, 0.45)',
            opacity: rerunCellGlow * glowPulse,
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 18,
            top: 18,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255, 138, 61, 0.55)',
            background: 'rgba(8, 22, 30, 0.82)',
            color: '#ffd5b2',
            fontFamily: monoFont,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.01em',
            opacity: badgeRerun,
            transform: `translateY(${mix(6, 0, badgeRerun)}px)`,
          }}
        >
          only these cells run: [5]-[7]
        </div>
        <div
          style={{
            position: 'absolute',
            right: 18,
            top: 58,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid rgba(141, 245, 166, 0.45)',
            background: 'rgba(8, 22, 30, 0.82)',
            color: '#d6f8e0',
            fontFamily: monoFont,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.01em',
            opacity: reasonHint,
            transform: `translateY(${mix(6, 0, reasonHint)}px)`,
          }}
        >
          reasoning: 10 / 5 = 2
        </div>
        <div
          style={{
            position: 'absolute',
            right: 18,
            top: 94,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid rgba(133, 223, 255, 0.48)',
            background: 'rgba(8, 22, 30, 0.82)',
            color: '#d8f4ff',
            fontFamily: monoFont,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.01em',
            opacity: planHint,
            transform: `translateY(${mix(6, 0, planHint)}px)`,
          }}
        >
          plan: edit base, rerun [5]-[7]
        </div>
        <div
          style={{
            position: 'absolute',
            right: 18,
            top: 18,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid rgba(69, 216, 201, 0.5)',
            background: 'rgba(8, 22, 30, 0.82)',
            color: '#c9f7ef',
            fontFamily: monoFont,
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '0.01em',
            opacity: outputFive,
            transform: `translateY(${mix(6, 0, outputFive)}px)`,
          }}
        >
          observed output: 5
        </div>
      </div>
    </PanelShell>
  );
};

const Background = () => {
  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(160deg, #050b12 0%, #0a1824 58%, #081420 100%)',
      }}
    />
  );
};

export const SkillShowcase = () => {
  const frame = useCurrentFrame();
  const stageIntro = easeProgress(frame, 10, 62);

  return (
    <AbsoluteFill>
      <Background />
      <HeaderBar frame={frame} />

      <div
        style={{
          position: 'absolute',
          left: 74,
          right: 74,
          top: 248,
          bottom: 48,
          display: 'flex',
          gap: 24,
          transform: `translateY(${mix(22, 0, stageIntro)}px)`,
          opacity: stageIntro,
        }}
      >
        <TerminalPane frame={frame} />
        <NotebookPane frame={frame} />
      </div>
    </AbsoluteFill>
  );
};
