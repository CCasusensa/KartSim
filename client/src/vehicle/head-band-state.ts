/**
 * Which of a 头饰 (headBand) item's four models a kart's physics state shows.
 *
 * Every stuff/headBand/<name>_N.1s set has the same four models: `_0` standing
 * (shown on reset), `_1` driving, `_2` the 번개 lightning loop (1200 ms; 653
 * of the 654 p3553 headbands draw it with the 번개 texture, and no other model
 * does) and `_3` a 500 ms bounce of the tips back to rest.
 *
 * The release table (`ae0`) is keyed by the original booster code, the one KSV
 * records still keep (`Gh0`/`BD` in generated/timeattack.js): 0 none -> `_1`,
 * 1 booster / 2 team booster -> `_2`, 3 instant booster -> `_3`; every other
 * code (7 start booster, 4 play booster, 5 boost pad, 6 jump pad) keeps the
 * model already shown. The release passed the native physics state instead,
 * where 1 is the start booster, 2 the drift instant boost (单喷) and 3 the
 * nitro, so the lightning played at the start and on 单喷 and never on nitro.
 * The native state is converted to the original code first here.
 */

/** Native physics state -> original booster code, as `Gh0` writes into KSV. */
function originalBoosterCode(physicsState: number): number {
  switch (physicsState) {
    case 1: return 7;
    case 2: return 3;
    case 3: case 5: case 6: case 7: case 8: return 1;
    case 4: return 2;
    // A dual booster (10) is still the nitro it started from. KSV keeps it in
    // the 8192 flag with code 0, which would cut the lightning off mid-boost.
    case 10: return 1;
    case 13: return 5;
    case 14: return 6;
    case 18: return 4;
    default: return 0;
  }
}

/** The headBand model index for `physicsState`, or undefined to keep the current one. */
export function headBandModelForBoosterState(physicsState: number): number | undefined {
  const code = originalBoosterCode(Math.trunc(physicsState));
  if (code === 0) return 1;
  if (code === 1 || code === 2) return 2;
  if (code === 3) return 3;
}
