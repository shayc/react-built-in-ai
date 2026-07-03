export function hasUserActivation(): boolean {
  // `navigator.userActivation` is not universally implemented — when the
  // browser can't answer, assume "no gesture" and let the activation-gated
  // paths park rather than proceed.
  return navigator.userActivation?.isActive ?? false;
}
