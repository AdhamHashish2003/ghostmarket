'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    __ghostPulse?: () => void;
    p5?: any;
  }
}

export default function NeuralMesh() {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5InstanceRef = useRef<any>(null);
  const pulseRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Expose global pulse trigger
    window.__ghostPulse = () => {
      pulseRef.current = true;
    };

    const loadAndInit = () => {
      // If p5 is already loaded, just init
      if (window.p5) {
        initSketch();
        return;
      }
      // Load p5.js from CDN
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js';
      script.onload = () => initSketch();
      document.head.appendChild(script);
    };

    const initSketch = () => {
      const P5 = window.p5;
      if (!P5 || !containerRef.current) return;

      const NODE_COUNT = 60;
      const CONNECTION_DIST = 150;
      const FPS = 30;

      p5InstanceRef.current = new P5((p: any) => {
        let nodes: Array<{
          x: number;
          y: number;
          noiseOffX: number;
          noiseOffY: number;
          speed: number;
          size: number;
        }> = [];
        let pulseTimer = 0;
        let pulseIntensity = 0;

        p.setup = () => {
          const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
          canvas.style('position', 'fixed');
          canvas.style('top', '0');
          canvas.style('left', '0');
          canvas.style('z-index', '-1');
          canvas.style('pointer-events', 'none');
          p.frameRate(FPS);

          // Initialize nodes
          for (let i = 0; i < NODE_COUNT; i++) {
            nodes.push({
              x: p.random(p.width),
              y: p.random(p.height),
              noiseOffX: p.random(1000),
              noiseOffY: p.random(1000),
              speed: p.random(0.002, 0.006),
              size: p.random(2, 4),
            });
          }
        };

        p.draw = () => {
          p.clear();

          // Check for pulse trigger
          if (pulseRef.current) {
            pulseRef.current = false;
            pulseTimer = 30; // 1 second at 30fps
            pulseIntensity = 1.0;
          }

          if (pulseTimer > 0) {
            pulseTimer--;
            pulseIntensity = pulseTimer / 30;
          }

          // Update node positions with Perlin noise
          for (const node of nodes) {
            node.noiseOffX += node.speed;
            node.noiseOffY += node.speed;
            node.x = p.noise(node.noiseOffX) * (p.width + 100) - 50;
            node.y = p.noise(node.noiseOffY) * (p.height + 100) - 50;
          }

          // Draw connections
          for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
              const d = p.dist(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y);
              if (d < CONNECTION_DIST) {
                const alpha = p.map(d, 0, CONNECTION_DIST, 25, 0); // ~10% opacity
                const pulseBoost = pulseIntensity * p.map(d, 0, CONNECTION_DIST, 60, 0);
                p.stroke(0, 240, 255, alpha + pulseBoost);
                p.strokeWeight(0.5);
                p.line(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y);
              }
            }
          }

          // Draw nodes
          p.noStroke();
          for (const node of nodes) {
            const baseAlpha = 76; // 30% of 255
            const pulseBoost = pulseIntensity * 179; // flash to full brightness
            p.fill(0, 240, 255, baseAlpha + pulseBoost);
            const sizeBoost = pulseIntensity * 3;
            p.ellipse(node.x, node.y, node.size + sizeBoost, node.size + sizeBoost);
          }
        };

        p.windowResized = () => {
          p.resizeCanvas(p.windowWidth, p.windowHeight);
        };
      }, containerRef.current);
    };

    loadAndInit();

    return () => {
      if (p5InstanceRef.current) {
        p5InstanceRef.current.remove();
        p5InstanceRef.current = null;
      }
      delete window.__ghostPulse;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: -1,
        pointerEvents: 'none',
      }}
    />
  );
}
