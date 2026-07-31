import { ImageResponse } from 'next/og';

/**
 * The card that appears when a link to this app is pasted into Slack, iMessage
 * or a social post.
 *
 * Generated rather than shipped as a PNG so it stays in step with the brand
 * colour and the product name without anyone remembering to re-export an
 * image. It is deliberately built from plain divs and system-default text —
 * `next/og` renders in a Satori runtime, not a browser, so Tailwind classes,
 * CSS variables and custom fonts do not apply here unless explicitly loaded.
 */

export const alt = 'myaichat — one chat interface, every model';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '80px',
        background: 'linear-gradient(135deg, #1e1b4b 0%, #4f46e5 100%)',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 22,
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 52,
              height: 38,
              borderRadius: 12,
              background: '#4f46e5',
            }}
          />
        </div>
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1.5 }}>myaichat</div>
      </div>

      <div style={{ marginTop: 48, fontSize: 44, lineHeight: 1.25, maxWidth: 900 }}>
        One chat interface. Every model.
      </div>

      <div style={{ marginTop: 24, fontSize: 28, opacity: 0.75 }}>
        Streaming chat across providers, with your own keys.
      </div>
    </div>,
    size,
  );
}
