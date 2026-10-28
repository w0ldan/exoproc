import type { VersionProfile } from './base.js';
import { VersionProfile1_5 } from './v1_5.js';
import { VersionProfile1_7 } from './v1_7.js';
import { VersionProfile1_8 } from './v1_8.js';
import { VersionProfile1_12 } from './v1_12.js';
import { VersionProfile1_16 } from './v1_16.js';
import { VersionProfile1_20 } from './v1_20.js';
import { VersionProfile1_20_5 } from './v1_20_5.js';

const profileRegistry = new Map<number, VersionProfile>();

// Register default built-in profiles
const defaultProfiles: VersionProfile[] = [
  new VersionProfile1_5(),
  new VersionProfile1_7(),
  new VersionProfile1_8(),
  new VersionProfile1_12(),
  new VersionProfile1_16(),
  new VersionProfile1_20(),
  new VersionProfile1_20_5(),
];

for (const profile of defaultProfiles) {
  profileRegistry.set(profile.protocolVersion, profile);
}

// Map era protocol versions to their base profiles
const p15 = profileRegistry.get(61)!;
profileRegistry.set(60, p15);

const p17 = profileRegistry.get(5)!;
profileRegistry.set(4, p17);

const p112 = profileRegistry.get(340)!;
for (const ver of [107, 108, 109, 110, 210, 315, 316, 335, 338]) {
  profileRegistry.set(ver, p112);
}

const p116 = profileRegistry.get(754)!;
for (const ver of [
  393, 401, 404, 477, 480, 485, 490, 498, 573, 575, 578, 735, 736, 751, 753,
]) {
  profileRegistry.set(ver, p116);
}

const p120 = profileRegistry.get(765) ?? profileRegistry.get(763)!;
for (const ver of [755, 756, 757, 758, 759, 760, 761, 762, 763, 764, 765]) {
  profileRegistry.set(ver, p120);
}

const p120_5 = profileRegistry.get(766)!;
for (const ver of [766, 767, 768, 769, 770]) {
  profileRegistry.set(ver, p120_5);
}

/**
 * Registers or overrides a version profile for a given protocol version.
 */
export function registerVersionProfile(profile: VersionProfile): void {
  profileRegistry.set(profile.protocolVersion, profile);
}

/**
 * Returns all registered version profiles.
 */
export function getAllRegisteredProfiles(): VersionProfile[] {
  return Array.from(profileRegistry.values());
}

/**
 * Resolves the appropriate VersionProfile for a given protocol version.
 * If an exact match is not found, it resolves to the closest compatible profile.
 */
export function getVersionProfile(protocolVersion: number): VersionProfile {
  const exact = profileRegistry.get(protocolVersion);
  if (exact) {
    return exact;
  }

  // Fallback heuristic based on protocol eras:
  if (
    protocolVersion === 61 ||
    (protocolVersion >= 60 && protocolVersion <= 78)
  ) {
    return profileRegistry.get(61)!;
  }
  if (protocolVersion <= 5) {
    return profileRegistry.get(5)!;
  }
  if (protocolVersion <= 47) {
    return profileRegistry.get(47)!;
  }
  if (protocolVersion <= 340) {
    return profileRegistry.get(340)!;
  }
  if (protocolVersion <= 754) {
    return profileRegistry.get(754)!;
  }
  if (protocolVersion <= 765) {
    return profileRegistry.get(765) ?? profileRegistry.get(763)!;
  }
  return profileRegistry.get(766)!;
}
