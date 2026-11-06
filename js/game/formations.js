import { CONFIG, clamp } from '../config.js';
import { pick, randInt } from '../core/utils.js';

const TEMPLATES = [
  { id: 'vFormation', paths: ['topDive'], min: 4, max: 5, spacing: 54, holdChance: 0.15 },
  { id: 'leftSweep', paths: ['leftArc'], min: 3, max: 4, spacing: 38, holdChance: 0.1 },
  { id: 'rightSweep', paths: ['rightArc'], min: 3, max: 4, spacing: 38, holdChance: 0.1 },
  { id: 'columnRun', paths: ['column'], min: 3, max: 4, spacing: 70, holdChance: 0.8 },
  { id: 'figure8', paths: ['figure8'], min: 3, max: 4, spacing: 60, holdChance: 0.7 },
  { id: 'attackRun', paths: ['divePlayer'], min: 3, max: 4, spacing: 46, holdChance: 0 },
  { id: 'pincer', paths: ['pincerLeft', 'pincerRight'], min: 4, max: 6, spacing: 30, holdChance: 0 },
  { id: 'spiral', paths: ['spiral'], min: 3, max: 5, spacing: 50, holdChance: 0.6 },
];

function availableTemplates(wave) {
  const list = TEMPLATES.filter((template) => {
    if (template.id === 'columnRun' || template.id === 'figure8') return wave >= 3;
    if (template.id === 'attackRun') return wave >= 5;
    if (template.id === 'pincer') return wave >= 7;
    if (template.id === 'spiral') return wave >= 9;
    return true;
  });
  return list.length ? list : TEMPLATES.slice(0, 3);
}

export function createSquad(wave) {
  const template = pick(availableTemplates(wave));
  const extra = Math.floor(wave / 10);
  const count = clamp(randInt(template.min, template.max) + extra, CONFIG.formations.squadMin, CONFIG.formations.squadMax);
  const eliteChance = clamp(0.06 + wave * 0.03, 0.06, 0.45);
  const members = [];

  for (let i = 0; i < count; i += 1) {
    const dx = (i - (count - 1) / 2) * template.spacing;
    members.push({
      pathKey: template.paths[i % template.paths.length],
      dx,
      delay: i * CONFIG.formations.delayStep,
      hold: Math.random() < template.holdChance,
      tier: Math.random() < eliteChance ? 'elite' : 'common',
    });
  }

  return { id: template.id, members };
}
