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

type TranscriptLineKind = 'prompt' | 'tools' | 'reply';

type Operation = {
  prompt: string;
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

const TARGET_NOTEBOOK_PATH = 'notebooks/tiny-demo.ipynb';
const TARGET_NOTEBOOK_PORT = 8888;

const OPERATIONS: Operation[] = [
  {
    prompt: 'run the value demo notebook',
    typeStart: 24,
    typeEnd: 78,
    submitFrame: 86,
    thinkingStart: 96,
    thinkingEnd: 166,
    toolsStart: 166,
    toolsEnd: 188,
    doneFrame: 214,
    replyText:
      'Confirmed via notebook picker: notebooks/tiny-demo.ipynb. Ran cell [2] (`value`) and got output 1.',
    toolsCalled: 3,
    toolDetails: 'notebooks, AskUserQuestion, execute',
  },
  {
    prompt: 'change value from 1 to 2 and rerun value',
    typeStart: 228,
    typeEnd: 280,
    submitFrame: 288,
    thinkingStart: 296,
    thinkingEnd: 360,
    toolsStart: 360,
    toolsEnd: 386,
    doneFrame: 416,
    replyText: 'Updated value from 1 to 2, reran, and confirmed the new output is 2.',
    toolsCalled: 2,
    toolDetails: 'edit, execute',
  },
  {
    prompt: 'add a new cell: value * 5, then run it',
    typeStart: 430,
    typeEnd: 492,
    submitFrame: 500,
    thinkingStart: 508,
    thinkingEnd: 546,
    toolsStart: 546,
    toolsEnd: 570,
    doneFrame: 596,
    replyText: 'Added a new cell with value * 5, ran it, and got output 10.',
    toolsCalled: 2,
    toolDetails: 'add-cell, execute',
  },
];

const transcriptLines: TranscriptLine[] = OPERATIONS.flatMap((op) => [
  {
    text: `> ${op.prompt}`,
    kind: 'prompt',
    start: op.submitFrame,
    speed: 4.2,
  },
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
]);

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
          Explore, edit, and rerun incrementally without restarting whole scripts.
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
  const status = statusText(frame);
  const isThinking = Boolean(status?.startsWith('Thinking'));
  const busy = isBusy(frame);
  const executingOp = activeOperation(frame);
  const executingPromptStart = executingOp ? executingOp.submitFrame : -1;

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
                    fontSize: line.kind === 'reply' ? 16 : isToolLine ? 15 : 17,
                    fontWeight: line.kind === 'reply' ? 500 : 400,
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

        <div style={{height: 36, display: 'flex', alignItems: 'center', padding: '2px 8px 0 8px'}}>
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
              border: `1px solid ${COLORS.panelBorder}`,
              background: 'rgba(6, 13, 20, 0.88)',
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
                  color: COLORS.amber,
                  fontFamily: monoFont,
                  fontSize: 18,
                  fontWeight: 700,
                }}
              >
                {'>'}
              </div>
              <div
                style={{
                  color: composerText ? '#e9f0f5' : '#748796',
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
                border: `1px solid ${COLORS.panelBorder}`,
                color: '#a8b7c3',
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
