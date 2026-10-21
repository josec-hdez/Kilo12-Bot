import { describe, expect, it } from 'vitest';
import {
  parseRelease,
  parseReleaseNotes,
  releaseAnnouncementText,
  shouldAnnounce,
} from '../../src/core/release.js';

describe('parseRelease', () => {
  it('sin versión no hay aviso', () => {
    expect(parseRelease(undefined, 'feat: algo')).toBeNull();
    expect(parseRelease('   ', undefined)).toBeNull();
  });

  it('recorta la versión y lee las notas', () => {
    expect(parseRelease(' a53ccff ', 'feat: uno')).toEqual({
      version: 'a53ccff',
      notes: ['feat: uno'],
    });
  });
});

describe('parseReleaseNotes', () => {
  it('acepta saltos escritos como texto y saltos reales, sin líneas vacías', () => {
    expect(parseReleaseNotes('feat: uno\\nfix: dos\n\n  docs: tres  ')).toEqual([
      'feat: uno',
      'fix: dos',
      'docs: tres',
    ]);
  });

  it('sin notas devuelve una lista vacía', () => {
    expect(parseReleaseNotes(undefined)).toEqual([]);
    expect(parseReleaseNotes('')).toEqual([]);
  });
});

describe('shouldAnnounce', () => {
  const release = { version: 'b2', notes: [] };

  it('avisa si la versión es nueva o nunca se anunció', () => {
    expect(shouldAnnounce(release, 'a1')).toBe(true);
    expect(shouldAnnounce(release, undefined)).toBe(true);
  });

  it('no repite la versión ya anunciada ni avisa sin versión', () => {
    expect(shouldAnnounce(release, 'b2')).toBe(false);
    expect(shouldAnnounce(null, 'a1')).toBe(false);
  });
});

describe('releaseAnnouncementText', () => {
  it('lista una nota por viñeta', () => {
    expect(releaseAnnouncementText({ version: 'b2', notes: ['feat: uno', 'fix: dos'] })).toBe(
      '🆕 Bot actualizado (v b2)\n• feat: uno\n• fix: dos\n\nTu menú ya está actualizado.',
    );
  });

  it('sin notas muestra solo la versión', () => {
    expect(releaseAnnouncementText({ version: 'b2', notes: [] })).toBe(
      '🆕 Bot actualizado (v b2)\n\nTu menú ya está actualizado.',
    );
  });
});
