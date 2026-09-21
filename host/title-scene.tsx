import { useEffect, useRef } from "react";

// A tiny ambient scene: no network assets, React animation state, or input capture.
export function TitleScene({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!,
      ctx = canvas.getContext("2d")!;
    let frame = 0,
      w = 0,
      h = 0;
    const stars = Array.from({ length: 100 }, (_, i) => ({
      x: ((i * 7919) % 997) / 997,
      y: ((i * 3571) % 991) / 991,
    }));
    const tiles = [
      [0, -3, 3],
      [1, -3, 3],
      [0, -2, 3],
      [1, -2, 3],
      [-1, -1, 0],
      [0, -1, 0],
      [1, -1, 0],
      [2, -1, 0],
      [3, -1, 2],
      [4, -1, 2],
      [-3, 0, 1],
      [-2, 0, 1],
      [-1, 0, 0],
      [0, 0, 4],
      [1, 0, 4],
      [2, 0, 0],
      [3, 0, 2],
      [4, 0, 2],
      [-3, 1, 1],
      [-2, 1, 1],
      [-1, 1, 0],
      [0, 1, 4],
      [1, 1, 4],
      [2, 1, 0],
      [0, 2, 0],
      [1, 2, 0],
      [0, 3, 5],
      [1, 3, 5],
      [0, 4, 5],
      [1, 4, 5],
    ];
    function draw(time: number) {
      const t = reduced ? 0 : time / 1000;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        ctx.fillStyle = `rgba(188,214,207,${0.15 + 0.18 * (1 + Math.sin(t * 0.35 + i))})`;
        ctx.fillRect(
          s.x * w,
          s.y * h,
          i % 9 === 0 ? 2 : 1,
          i % 9 === 0 ? 2 : 1,
        );
      }
      const size = Math.min(w * 0.054, h * 0.085, 90),
        cx = w < 650 ? w * 0.73 : w * 0.72,
        cy = h * 0.48;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.13);
      for (let r = 0; r < 3; r++) {
        ctx.strokeStyle = `rgba(124,166,141,${0.12 - r * 0.025})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, size * (4.8 + r * 1.8), 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let m = 0; m < 4; m++) {
        const a = (m * Math.PI) / 2 + t * 0.014,
          r = size * 6.4;
        ctx.save();
        ctx.translate(Math.cos(a) * r, Math.sin(a) * r);
        ctx.rotate(Math.PI / 4);
        ctx.shadowColor = "#a2e0b9";
        ctx.shadowBlur = 18;
        ctx.fillStyle = "#accb9a";
        ctx.fillRect(-size * 0.15, -size * 0.15, size * 0.3, size * 0.3);
        ctx.restore();
      }
      const colors = [
        "#667e89",
        "#cc9870",
        "#cfb65f",
        "#b67887",
        "#c4cea0",
        "#73a08b",
      ];
      for (const [x, y, c] of tiles) {
        const px = (x - 1) * size,
          py = (y - 0.5) * size;
        ctx.fillStyle = "#050f17";
        ctx.fillRect(px + 8, py + 13, size - 3, size - 3);
        ctx.fillStyle = colors[c];
        ctx.fillRect(px, py, size - 3, size - 3);
        ctx.fillStyle = "#ffffff20";
        ctx.fillRect(px, py, size - 3, 3);
        if (c !== 0 && c !== 4) {
          ctx.strokeStyle = "#102c3455";
          ctx.lineWidth = 3;
          ctx.strokeRect(
            px + size * 0.23,
            py + size * 0.23,
            size * 0.48,
            size * 0.48,
          );
        }
      }
      // Commander and workers walk along the connecting passage.
      for (let i = 0; i < 4; i++) {
        const phase = t * 0.38 + i * 1.9,
          x = Math.sin(phase) * size * 1.8,
          y = -size * 0.5 + Math.cos(phase) * size * 0.42;
        ctx.fillStyle = "#08151d";
        ctx.fillRect(x - 4, y - 2, 12, 15);
        ctx.fillStyle = i === 0 ? "#ecf3c9" : "#d9e6df";
        ctx.fillRect(x - 3, y - 5, 8, 9);
        ctx.fillStyle = "#8cb89c";
        ctx.fillRect(x - 3, y + 5, 3, 4);
        ctx.fillRect(x + 2, y + 5, 3, 4);
        if (i === 0) {
          ctx.strokeStyle = "#d2eeb0";
          ctx.beginPath();
          ctx.ellipse(x + 1, y + 14, 12, 4, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
      if (!reduced) frame = requestAnimationFrame(draw);
    }
    function resize() {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      const d = Math.min(devicePixelRatio, 2);
      canvas.width = w * d;
      canvas.height = h * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      if (reduced) draw(0);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    draw(0);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [reduced]);
  return <canvas ref={ref} className="title-scene" aria-hidden="true" />;
}
