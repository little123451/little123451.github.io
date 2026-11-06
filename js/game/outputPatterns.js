const PARALLEL_SPACING = 16;
const FAN_X_SPACING = 10;

function spawnVolley(player, spawn) {
  const skill = player.skillData;
  const count = skill.shots;
  const spread = (skill.spreadDeg * Math.PI) / 180;
  const baseAngle = -Math.PI / 2;

  for (let i = 0; i < count; i += 1) {
    let angle = baseAngle;
    let xOffset = 0;
    if (count > 1) {
      const t = (i - (count - 1) / 2) / ((count - 1) / 2 || 1);
      if (spread > 0) {
        angle = baseAngle + t * spread;
        xOffset = t * FAN_X_SPACING;
      } else {
        xOffset = (i - (count - 1) / 2) * PARALLEL_SPACING;
      }
    }
    spawn({
      x: player.x + xOffset,
      y: player.y - 26,
      angle,
      pierce: skill.pierce,
    });
  }
}

export const OUTPUT_PATTERNS = {
  volley: spawnVolley,
};

export function firePattern(patternId, player, spawn) {
  const pattern = OUTPUT_PATTERNS[patternId] || OUTPUT_PATTERNS.volley;
  pattern(player, spawn);
}
