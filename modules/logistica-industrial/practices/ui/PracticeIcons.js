// Local vector icons share a 24-unit grid, round joins and the HUD's colour.
// No external font, image request or platform-specific emoji is required.
const paths = {
 missions: 'M5 4h14v17H5V4ZM9 4V2h6v2M8 9l1 1 2-2M13 9h3M8 14l1 1 2-2M13 14h3M8 18h8',
 instructions: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 10v6M12 7v.1',
 layout: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5ZM9 3v16M15 5v16M5 10l2 1M11 12l2-1M17 9l2-1',
 guide: 'M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v16M5 8h4M5 12h4M15 8h4M15 12h4',
 video: 'M3 4h18v16H3V4Zm0 4h18M7 4l3 4M13 4l3 4M10 11l5 3-5 3v-6Z',
 documentation: 'M5 2h9l5 5v15H5V2ZM14 2v5h5M8 11h8M8 15h8M8 19h5',
 equipment: 'M3 21h10M6 21v-4l4-4M10 13 5 8l3-4 7 3M15 7l5 4-3 4M17 15l-3 2M17 15l3 2M8 4a2 2 0 1 0 0 .1M15 7a2 2 0 1 0 0 .1',
 controls: 'M7 7h10a5 5 0 0 1 4.9 4l1 6a2.6 2.6 0 0 1-4.5 2.2L15 16H9l-3.4 3.2A2.6 2.6 0 0 1 1.1 17l1-6A5 5 0 0 1 7 7ZM7 10v5M4.5 12.5h5M16 11v.1M19 14v.1',
 camera: 'M3 7h4l2-3h6l2 3h4v14H3V7ZM16 13a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM18 10h.1',
 walk: 'M13 6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8 21l3-7-2-4-3 4M11 7l4 1 2 4 4 1M11 7l-2 3M11 14l5 3 1 5',
 drone: 'M8 10h8v7H8v-7ZM8 10 5 6M16 10l3-4M8 17l-3 3M16 17l3 3M1 5h8M15 5h8M1 21h8M15 21h8M5 3v4M19 3v4M5 19v4M19 19v4',
 menu: 'M4 6h16M4 12h16M4 18h16',
 close: 'm6 6 12 12M6 18 18 6',
 progress: 'M13 6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8 21l3-7-2-4-3 4M11 7l4 1 2 4 4 1M11 7l-2 3M11 14l5 3 1 5',
 score: 'M8 3h8v8a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 15v5M8 21h8',
 time: 'M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 10v5l3 2M9 2h6M12 2v4M18 5l2 2',
 check: 'm5 12 5 5 9-10',
 chevron: 'm9 5 7 7-7 7',
 settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
 record: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 8h8v8H8V8Z',
 mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
 voice: 'M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4',
 assistant: 'm12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z'
};

export function practiceIcon(name, size = 24) {
 const ns = 'http://www.w3.org/2000/svg';
 const svg = document.createElementNS(ns, 'svg');
 svg.setAttribute('viewBox', '0 0 24 24');
 svg.setAttribute('width', String(size));
 svg.setAttribute('height', String(size));
 svg.setAttribute('fill', 'none');
 svg.setAttribute('stroke', 'currentColor');
 svg.setAttribute('stroke-width', '1.65');
 svg.setAttribute('stroke-linecap', 'round');
 svg.setAttribute('stroke-linejoin', 'round');
 svg.setAttribute('aria-hidden', 'true');
 svg.setAttribute('focusable', 'false');
 svg.setAttribute('class', 'st-practice-icon');
 const path = document.createElementNS(ns, 'path');
 path.setAttribute('d', paths[name] || paths.guide);
 svg.appendChild(path);
 return svg;
}
